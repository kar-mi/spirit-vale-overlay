import type { BackendReady, ClientPacket, RpcPacket, ServerPacket, StartupFailure } from "../shared/protocol.ts";
import { backendConnectionFromSearch } from "../shared/backend-connection.ts";
import {
  BACKEND_LOST_MESSAGE,
  clearBackendFailureUi,
  renderStartupFailure,
  setBackendBanner,
  type StartupFailureActions,
} from "./failure-ui.ts";

type Handler = (packet: RpcPacket) => void;

// The launcher gets fresh tickets from the backend, so it retries ~165s to ride out a
// restart; a child window's ticket is single-use and spent, so it concedes fast.
const CHILD_RECONNECT_ATTEMPT_LIMIT = 5;
const LAUNCHER_RECONNECT_ATTEMPT_LIMIT = 25;
const RECONNECT_BASE_DELAY_MS = 250;
const RECONNECT_MAX_DELAY_MS = 8_000;

/** The parts of the connect/reconnect loop that differ between the Neutralino and Electron shells. */
export interface ShellFrontendBridge {
  awaitConnection(onSlow: (failure: StartupFailure) => void): Promise<BackendReady>;
  failureActions: StartupFailureActions;
  /** Discard anything `awaitConnection` cached, before a reconnect attempt re-asks for it. */
  reset?(): void;
  bootstrap?(): Promise<void>;
  helloExtras?(): Promise<Partial<ClientPacket & { kind: "hello" }>>;
  onSessionReady?(socket: WebSocket): Promise<void>;
  onWindowCommand?(socket: WebSocket, command: ServerPacket & { kind: "window-command" }): Promise<void>;
  onFatal?(handler: (failure: StartupFailure) => void): () => void;
}

// The launcher window shows a reconnecting hint instead of the full-window failure
// overlay while the transport retries; this is how it learns the retry state.
let onReconnectingChange: ((reconnecting: boolean) => void) | undefined;

export function watchBackendReconnecting(listener: (reconnecting: boolean) => void): void {
  onReconnectingChange = listener;
}

function reportReconnecting(reconnecting: boolean): void {
  onReconnectingChange?.(reconnecting);
}

export class StartupFailureError extends Error {
  constructor(readonly failure: StartupFailure) {
    super(failure.message);
    this.name = "StartupFailureError";
  }
}

export function toStartupFailure(error: unknown): StartupFailure {
  if (error instanceof StartupFailureError) return error.failure;
  const message = error instanceof Error ? error.message : String(error);
  return { phase: "backend handshake", operation: "connect", message };
}

export class DesktopTransport {
  private socket?: WebSocket;
  private handler?: Handler;
  private readonly queued: RpcPacket[] = [];
  private connecting = false;
  private sessionReady = false;
  private bootstrapped = false;
  private reconnectAttempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private terminalFailure = false;
  private readonly launcher = backendConnectionFromSearch(location.search) === undefined;

  constructor(
    private readonly bridge: ShellFrontendBridge,
    private readonly describeFailure: (error: unknown) => StartupFailure = toStartupFailure,
  ) {
    this.bridge.onFatal?.((failure) => this.fail(failure, true));
    void this.connect().catch((error) => {
      if (!this.terminalFailure) this.fail(this.describeFailure(error));
    });
  }

  send(packet: RpcPacket): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.queued.push(packet);
      return;
    }
    this.socket.send(JSON.stringify({ kind: "rpc", packet } satisfies ClientPacket));
  }

  sendWindowEvent(event: string, data: unknown): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ kind: "window-event", event, data } satisfies ClientPacket));
  }

  registerHandler(handler: Handler): void {
    this.handler = handler;
  }

  private async connect(): Promise<void> {
    if (this.connecting) return;
    this.connecting = true;
    try {
      if (this.launcher && !this.bootstrapped) {
        await this.bridge.bootstrap?.();
        this.bootstrapped = true;
      }
      const connection = await this.bridge.awaitConnection((failure) => {
        console.warn(failure.message);
        reportReconnecting(true);
      });
      clearBackendFailureUi();
      reportReconnecting(false);
      const socket = new WebSocket(`ws://127.0.0.1:${connection.port}/rpc`);
      this.socket = socket;
      socket.addEventListener("open", async () => {
        const extras = await this.bridge.helloExtras?.() ?? {};
        socket.send(JSON.stringify({ ...extras, kind: "hello", ticket: connection.ticket } satisfies ClientPacket));
      });
      socket.addEventListener("message", (event) => void this.receive(String(event.data)));
      socket.addEventListener("close", () => this.disconnected());
      socket.addEventListener("error", () => console.error("The desktop backend connection failed."));
    } finally {
      this.connecting = false;
    }
  }

  private async receive(serialized: string): Promise<void> {
    let packet: ServerPacket;
    try { packet = JSON.parse(serialized) as ServerPacket; } catch { return; }
    if (packet.kind === "ready") {
      this.sessionReady = true;
      this.reconnectAttempts = 0;
      clearBackendFailureUi();
      reportReconnecting(false);
      for (const queued of this.queued.splice(0)) this.send(queued);
      if (this.socket) await this.bridge.onSessionReady?.(this.socket);
      return;
    }
    if (packet.kind === "rpc") { this.handler?.(packet.packet); return; }
    if (packet.kind === "window-command") {
      if (this.socket) await this.bridge.onWindowCommand?.(this.socket, packet);
      return;
    }
    if (packet.kind === "fatal") this.fail(this.describeFailure(packet.message), true);
  }

  private fail(failure: StartupFailure, terminal = false): void {
    if (terminal) {
      this.terminalFailure = true;
      if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    console.error(failure.message);
    document.body.dataset["backendError"] = failure.message;
    reportReconnecting(false);
    if (this.launcher) renderStartupFailure(failure, this.bridge.failureActions);
    else setBackendBanner(BACKEND_LOST_MESSAGE);
  }

  private disconnected(): void {
    const wasReady = this.sessionReady;
    this.sessionReady = false;
    this.socket = undefined;
    if (this.terminalFailure) return;
    if (wasReady && !this.launcher) {
      console.error("The desktop backend disconnected after the app started.");
      document.body.dataset["backendError"] = "backend disconnected";
      setBackendBanner(BACKEND_LOST_MESSAGE);
      return;
    }
    if (wasReady) reportReconnecting(true);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== undefined) return;
    const attemptLimit = this.launcher ? LAUNCHER_RECONNECT_ATTEMPT_LIMIT : CHILD_RECONNECT_ATTEMPT_LIMIT;
    if (this.reconnectAttempts >= attemptLimit) {
      this.fail(this.describeFailure("The desktop backend connection could not be re-established."));
      return;
    }
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_DELAY_MS);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.bridge.reset?.();
      void this.connect().catch((error) => this.fail(this.describeFailure(error)));
    }, delay);
  }
}
