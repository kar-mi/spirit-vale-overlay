import { app, events, filesystem, init, os, window as neutralinoWindow } from "@neutralinojs/lib";
import type { DesktopRPCSchema } from "@svoverlay/contracts/rpc";
import { bundleLogPaths } from "@svoverlay/desktop-platform/bundle-layout";

import type { BackendReady, ClientPacket, RpcPacket, ServerPacket, StartupFailure } from "../shared/protocol.ts";
import { backendConnectionFromSearch } from "../shared/backend-connection.ts";
import { defineRpc, type RpcInstance } from "../shared/rpc.ts";
import { BootstrapRuntimeError, neutralinoPlatform, verifyBootstrapFiles } from "./bootstrap-preflight.ts";
import { BACKEND_LOST_MESSAGE, clearBackendFailureUi, renderStartupFailure, setBackendBanner } from "./failure-ui.ts";

type Handler = (packet: RpcPacket) => void;
interface WindowFrame { x: number; y: number; width: number; height: number }

// The launcher gets fresh tickets from the backend, so it retries ~165s to ride out a
// restart; a child window's ticket is single-use and spent, so it concedes fast.
const CHILD_RECONNECT_ATTEMPT_LIMIT = 5;
const LAUNCHER_RECONNECT_ATTEMPT_LIMIT = 25;
const RECONNECT_BASE_DELAY_MS = 250;
const RECONNECT_MAX_DELAY_MS = 8_000;

// The launcher window shows a reconnecting hint instead of the full-window failure
// overlay while the transport retries; this is how it learns the retry state.
let onReconnectingChange: ((reconnecting: boolean) => void) | undefined;

export function watchBackendReconnecting(listener: (reconnecting: boolean) => void): void {
  onReconnectingChange = listener;
}

function reportReconnecting(reconnecting: boolean): void {
  onReconnectingChange?.(reconnecting);
}

// @neutralinojs/lib silently queues native calls made before its socket opens, and the
// failure card can render that early — so its buttons must wait for "ready" first.
let neutralinoReady = false;
const whenNeutralinoReady = (): Promise<void> =>
  neutralinoReady ? Promise.resolve() : new Promise((resolve) => void events.on("ready", () => resolve()));

async function quitApplication(): Promise<void> {
  await whenNeutralinoReady();
  await app.exit().catch((error) => console.error("Exit failed.", error));
}

async function openApplicationFolder(path: string): Promise<void> {
  await whenNeutralinoReady();
  await os.open(path).catch((error) => console.error("Opening the application folder failed.", error));
}

class DesktopTransport {
  private socket?: WebSocket;
  private handler?: Handler;
  private readonly queued: RpcPacket[] = [];
  private connecting = false;
  private sessionReady = false;
  private bootstrapChecked = false;
  private reconnectAttempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly launcher = backendConnectionFromSearch(location.search) === undefined;

  constructor() {
    init();
    void events.on("ready", () => { neutralinoReady = true; });
    void this.connect().catch((error) => this.fail(startupFailure(error)));
    void settleInitialWindowSize();
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
      if (this.launcher && !this.bootstrapChecked) {
        const globals = globalThis as typeof globalThis & { NL_PATH?: unknown; NL_OS?: unknown };
        if (typeof globals.NL_PATH === "string") {
          await verifyBootstrapFiles({
            applicationPath: globals.NL_PATH,
            platform: neutralinoPlatform(typeof globals.NL_OS === "string" ? globals.NL_OS : "Windows"),
            filesystem,
          });
        }
        this.bootstrapChecked = true;
      }
      const connection = await backendConnection((failure) => {
        console.warn(failure.message);
        reportReconnecting(true);
      });
      clearBackendFailureUi();
      reportReconnecting(false);
      const socket = new WebSocket(`ws://127.0.0.1:${connection.port}/rpc`);
      this.socket = socket;
      socket.addEventListener("open", async () => {
        const processId = await app.getProcessId().catch(() => undefined);
        socket.send(JSON.stringify({ kind: "hello", ticket: connection.ticket, processId } satisfies ClientPacket));
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
    try {
      packet = JSON.parse(serialized) as ServerPacket;
    } catch {
      return;
    }
    if (packet.kind === "ready") {
      this.sessionReady = true;
      this.reconnectAttempts = 0;
      clearBackendFailureUi();
      reportReconnecting(false);
      for (const queued of this.queued.splice(0)) this.send(queued);
      await registerWindowEvents(this.socket!);
      return;
    }
    if (packet.kind === "rpc") {
      this.handler?.(packet.packet);
      return;
    }
    if (packet.kind === "window-command") {
      await executeWindowCommand(this.socket!, packet.id, packet.method, packet.params);
      return;
    }
    if (packet.kind === "fatal") this.fail(startupFailure(packet.message));
  }

  private fail(failure: StartupFailure): void {
    console.error(failure.message);
    document.body.dataset["backendError"] = failure.message;
    reportReconnecting(false);
    if (this.launcher) renderStartupFailure(failure, { openApplicationFolder, quitApplication });
    else setBackendBanner(BACKEND_LOST_MESSAGE);
  }

  private disconnected(): void {
    const wasReady = this.sessionReady;
    this.sessionReady = false;
    this.socket = undefined;
    if (!wasReady) {
      this.scheduleReconnect();
      return;
    }
    if (!this.launcher) {
      console.error("The desktop backend disconnected after the app started.");
      document.body.dataset["backendError"] = "backend disconnected";
      setBackendBanner(BACKEND_LOST_MESSAGE);
      return;
    }
    reportReconnecting(true);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== undefined) return;
    const attemptLimit = this.launcher ? LAUNCHER_RECONNECT_ATTEMPT_LIMIT : CHILD_RECONNECT_ATTEMPT_LIMIT;
    if (this.reconnectAttempts >= attemptLimit) {
      this.fail(startupFailure("The desktop backend connection could not be re-established."));
      return;
    }
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_DELAY_MS);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch((error) => this.fail(startupFailure(error)));
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
    let lastFrame: WindowFrame | undefined;
    // Neutralino emits no native move/resize events and this proxy moves the window locally, so
    // the backend only learns where a window ended up — and can save it — if we report it.
    const reportFrame = (frame: WindowFrame): void => {
      if (!lastFrame || frame.x !== lastFrame.x || frame.y !== lastFrame.y) {
        transport.sendWindowEvent("windowMove", { x: frame.x, y: frame.y });
      }
      if (!lastFrame || frame.width !== lastFrame.width || frame.height !== lastFrame.height) {
        transport.sendWindowEvent("windowResize", { width: frame.width, height: frame.height });
      }
    };
    const request = new Proxy(rpc.request as object, {
      get(target, property, receiver) {
        if (property === "windowAction") return async ({ action }: { action: "minimize" | "close" }) => {
          if (action === "minimize") await neutralinoWindow.minimize();
          else await app.exit();
        };
        if (property === "getWindowFrame") return async () => {
          const [position, size] = await Promise.all([neutralinoWindow.getPosition(), neutralinoWindow.getSize()]);
          const frame = { x: position.x!, y: position.y!, width: size.width!, height: size.height! };
          lastFrame = frame;
          return frame;
        };
        if (property === "setWindowFrame") return async (frame: WindowFrame) => {
          if (!lastFrame || frame.x !== lastFrame.x || frame.y !== lastFrame.y) {
            await neutralinoWindow.move(frame.x, frame.y);
          }
          if (!lastFrame || frame.width !== lastFrame.width || frame.height !== lastFrame.height) {
            await neutralinoWindow.setSize({ width: frame.width, height: frame.height });
          }
          reportFrame(frame);
          lastFrame = frame;
        };
        return Reflect.get(target, property, receiver);
      },
    }) as typeof rpc.request;
    return { ...rpc, request, proxy: { ...rpc.proxy, request } } as RpcInstance<Schema, "webview">;
  }
}

async function settleInitialWindowSize(): Promise<void> {
  // WebView2's internal control bounds can initialize slightly out of sync with the
  // actual native window size, leaving the initial render wrong until any resize forces
  // a relayout. Nudge the size once, right after load, to force that relayout up front.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const size = await neutralinoWindow.getSize().catch(() => undefined);
  if (size?.width == null || size.height == null) return;
  await neutralinoWindow.setSize({ width: size.width, height: size.height + 1 }).catch(() => {});
  await neutralinoWindow.setSize({ width: size.width, height: size.height }).catch(() => {});
}

async function backendConnection(onSlow: (failure: StartupFailure) => void): Promise<BackendReady> {
  const connection = backendConnectionFromSearch(location.search);
  if (connection) return connection;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => onSlow(startupFailure(
      "The desktop backend is taking longer than expected. Required files may be delayed or temporarily blocked.",
    )), 10_000);
    void events.on("desktopBackendReady", (event) => finish(() => resolve(event.detail as BackendReady)));
    void events.on("desktopBackendFatal", (event) => finish(() => reject(new StartupFailureError(event.detail as StartupFailure))));
  });
}

class StartupFailureError extends Error {
  constructor(readonly failure: StartupFailure) {
    super(failure.message);
    this.name = "StartupFailureError";
  }
}

function startupFailure(error: unknown): StartupFailure {
  if (error instanceof StartupFailureError) return error.failure;
  if (error instanceof BootstrapRuntimeError) {
    const applicationPath = neutralinoApplicationPath();
    return {
      ...error.details,
      phase: "frontend bootstrap",
      category: "bundle",
      ...(applicationPath === undefined ? {} : {
        applicationPath,
        logPaths: bundleLogPaths(applicationPath),
      }),
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  const applicationPath = neutralinoApplicationPath();
  return {
    phase: "backend handshake",
    operation: "connect",
    message,
    ...(applicationPath === undefined ? {} : {
      applicationPath,
      logPaths: bundleLogPaths(applicationPath),
    }),
  };
}

function neutralinoApplicationPath(): string | undefined {
  const globals = globalThis as typeof globalThis & { NL_PATH?: unknown };
  return typeof globals.NL_PATH === "string" ? globals.NL_PATH : undefined;
}

async function registerWindowEvents(socket: WebSocket): Promise<void> {
  for (const eventName of ["windowClose", "windowFocus", "windowBlur", "windowMinimize", "windowRestore", "windowMaximize", "windowMove", "windowResize"]) {
    await events.on(eventName, (event) => {
      socket.send(JSON.stringify({ kind: "window-event", event: eventName, data: event.detail } satisfies ClientPacket));
    });
  }
}

async function executeWindowCommand(socket: WebSocket, id: number, method: string, params: unknown): Promise<void> {
  try {
    const value = params as Record<string, unknown> | undefined;
    let result: unknown;
    switch (method) {
      case "show": result = await neutralinoWindow.show(); break;
      case "hide": result = await neutralinoWindow.hide(); break;
      case "focus": result = await neutralinoWindow.focus(); break;
      case "close": result = await app.exit(); break;
      case "minimize": result = await neutralinoWindow.minimize(); break;
      case "maximize": result = await neutralinoWindow.maximize(); break;
      case "unmaximize": result = await neutralinoWindow.unmaximize(); break;
      case "setAlwaysOnTop": result = await neutralinoWindow.setAlwaysOnTop(Boolean(value?.["enabled"])); break;
      case "setBounds": {
        const x = Number(value?.["x"]);
        const y = Number(value?.["y"]);
        const width = Number(value?.["width"]);
        const height = Number(value?.["height"]);
        const position = await neutralinoWindow.getPosition();
        if (x !== position.x || y !== position.y) await neutralinoWindow.move(x, y);
        // Always set the size so Neutralino refreshes the WebView2 controller bounds, even when
        // the outer HWND already reports the requested dimensions.
        result = await neutralinoWindow.setSize({ width, height });
        break;
      }
      case "getBounds": {
        const [position, size] = await Promise.all([neutralinoWindow.getPosition(), neutralinoWindow.getSize()]);
        result = { ...position, ...size };
        break;
      }
      case "isMaximized": result = await neutralinoWindow.isMaximized(); break;
      case "openExternal": result = await os.open(String(value?.["url"])); break;
      case "createWindow": result = await neutralinoWindow.create(
        String(value?.["url"]),
        value?.["options"] as Parameters<typeof neutralinoWindow.create>[1],
      ); break;
      case "executeJavascript": result = globalThis.eval(String(value?.["script"])); break;
      default: throw new Error(`Unknown window command: ${method}`);
    }
    socket.send(JSON.stringify({ kind: "window-result", id, result } satisfies ClientPacket));
  } catch (error) {
    socket.send(JSON.stringify({
      kind: "window-result",
      id,
      error: error instanceof Error ? error.message : JSON.stringify(error),
    } satisfies ClientPacket));
  }
}

export default { DesktopView };
