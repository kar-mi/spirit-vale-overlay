import type { DesktopRPCSchema } from "@svoverlay/contracts/rpc";
import type { ClientPacket, RpcPacket, ServerPacket, StartupFailure } from "@svoverlay/desktop/src/shared/protocol.ts";
import { backendConnectionFromSearch } from "@svoverlay/desktop/src/shared/backend-connection.ts";
import { defineRpc, type RpcInstance } from "@svoverlay/desktop/src/shared/rpc.ts";
import {
  BACKEND_LOST_MESSAGE,
  clearBackendFailureUi,
  renderStartupFailure,
  setBackendBanner,
} from "@svoverlay/desktop/src/frontend/failure-ui.ts";
import type { SpiritValeBridge } from "../main/preload.ts";


declare global {
  interface Window { spiritVale: SpiritValeBridge }
}

interface WindowFrame { x: number; y: number; width: number; height: number }
type Handler = (packet: RpcPacket) => void;

const CHILD_RECONNECT_ATTEMPT_LIMIT = 5;
const LAUNCHER_RECONNECT_ATTEMPT_LIMIT = 25;
const RECONNECT_BASE_DELAY_MS = 250;
const RECONNECT_MAX_DELAY_MS = 8_000;

let onReconnectingChange: ((reconnecting: boolean) => void) | undefined;

export function watchBackendReconnecting(listener: (reconnecting: boolean) => void): void {
  onReconnectingChange = listener;
}

function reportReconnecting(reconnecting: boolean): void {
  onReconnectingChange?.(reconnecting);
}

interface BackendReady { port: number; ticket: string }

class DesktopTransport {
  private socket?: WebSocket;
  private handler?: Handler;
  private readonly queued: RpcPacket[] = [];
  private connecting = false;
  private sessionReady = false;
  private reconnectAttempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly launcher = backendConnectionFromSearch(location.search) === undefined;
  private ready?: Promise<BackendReady>;

  constructor() {
    void this.connect().catch((error) => this.fail(toFailure(error)));
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

  private connectionInfo(): Promise<BackendReady> {
    const fromSearch = backendConnectionFromSearch(location.search);
    if (fromSearch) return Promise.resolve(fromSearch);
    this.ready ??= new Promise<BackendReady>((resolve, reject) => {
      const timer = setTimeout(() => {
        reportReconnecting(true);
      }, 10_000);
      window.spiritVale.onBackendReady((payload) => { clearTimeout(timer); resolve(payload); });
      window.spiritVale.onBackendFatal((payload) => { clearTimeout(timer); reject(new StartupFailureError(payload as StartupFailure)); });
    });
    return this.ready;
  }

  private async connect(): Promise<void> {
    if (this.connecting) return;
    this.connecting = true;
    try {
      const connection = await this.connectionInfo();
      clearBackendFailureUi();
      reportReconnecting(false);
      const socket = new WebSocket(`ws://127.0.0.1:${connection.port}/rpc`);
      this.socket = socket;
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ kind: "hello", ticket: connection.ticket } satisfies ClientPacket));
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
      return;
    }
    if (packet.kind === "rpc") { this.handler?.(packet.packet); return; }
    if (packet.kind === "fatal") this.fail(toFailure(packet.message));
  }

  private fail(failure: StartupFailure): void {
    console.error(failure.message);
    document.body.dataset["backendError"] = failure.message;
    reportReconnecting(false);
    if (this.launcher) {
      renderStartupFailure(failure, {
        openApplicationFolder: (target) => void window.spiritVale.openPath(target),
        quitApplication: () => void window.spiritVale.quit(),
      });
    } else {
      setBackendBanner(BACKEND_LOST_MESSAGE);
    }
  }

  private disconnected(): void {
    const wasReady = this.sessionReady;
    this.sessionReady = false;
    this.socket = undefined;
    if (wasReady && !this.launcher) {
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
      this.fail(toFailure("The desktop backend connection could not be re-established."));
      return;
    }
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_DELAY_MS);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.ready = undefined;
      void this.connect().catch((error) => this.fail(toFailure(error)));
    }, delay);
  }
}

const transport = new DesktopTransport();

export class DesktopView<T extends { setTransport(transport: DesktopTransport): void }> {
  readonly rpc: T;

  constructor(config: { rpc: T }) {
    this.rpc = config.rpc;
    this.rpc.setTransport(transport);
  }

  static defineRPC<Schema extends DesktopRPCSchema>(config: Parameters<typeof defineRpc<Schema, "webview">>[1]) {
    const rpc = defineRpc<Schema, "webview">("webview", config as never) as RpcInstance<Schema, "webview">;
    const request = new Proxy(rpc.request as object, {
      get(target, property, receiver) {
        if (property === "windowAction") return ({ action }: { action: "minimize" | "close" }) => window.spiritVale.windowAction(action);
        if (property === "getWindowFrame") return () => window.spiritVale.getWindowFrame();
        if (property === "setWindowFrame") return (frame: WindowFrame) => window.spiritVale.setWindowFrame(frame);
        return Reflect.get(target, property, receiver);
      },
    }) as typeof rpc.request;
    return { ...rpc, request, proxy: { ...rpc.proxy, request } } as RpcInstance<Schema, "webview">;
  }
}

class StartupFailureError extends Error {
  constructor(readonly failure: StartupFailure) {
    super(failure.message);
    this.name = "StartupFailureError";
  }
}

function toFailure(error: unknown): StartupFailure {
  if (error instanceof StartupFailureError) return error.failure;
  const message = error instanceof Error ? error.message : String(error);
  return { phase: "backend handshake", operation: "connect", message };
}

export default { DesktopView };
