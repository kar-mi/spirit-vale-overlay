import { app, events, init, os, window as neutralinoWindow } from "@neutralinojs/lib";
import type { DesktopRPCSchema } from "@svoverlay/contracts/rpc";

import type { BackendReady, ClientPacket, RpcPacket, ServerPacket, StartupFailure } from "../shared/protocol.ts";
import { backendConnectionFromSearch } from "../shared/backend-connection.ts";
import { defineRpc, type RpcInstance } from "../shared/rpc.ts";

type Handler = (packet: RpcPacket) => void;

class DesktopTransport {
  private socket?: WebSocket;
  private handler?: Handler;
  private readonly queued: RpcPacket[] = [];
  private connecting = false;
  private sessionReady = false;
  private readonly launcher = backendConnectionFromSearch(location.search) === undefined;

  constructor() {
    init();
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

  registerHandler(handler: Handler): void {
    this.handler = handler;
  }

  private async connect(): Promise<void> {
    if (this.connecting) return;
    this.connecting = true;
    try {
      const connection = await backendConnection((failure) => renderStartupFailure(failure, "slow"));
      document.getElementById("desktop-startup-failure")?.remove();
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
      document.getElementById("desktop-startup-failure")?.remove();
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
    renderStartupFailure(failure, "terminal");
  }

  private disconnected(): void {
    const wasReady = this.sessionReady;
    this.sessionReady = false;
    this.socket = undefined;
    if (!wasReady) {
      void this.connect().catch((error) => this.fail(startupFailure(error)));
      return;
    }
    const failure = startupFailure("The desktop backend disconnected after the app started.");
    if (!this.launcher) {
      renderStartupFailure(failure, "runtime");
      return;
    }
    renderStartupFailure(failure, "reconnecting");
    void this.connect().catch((error) => this.fail(startupFailure(error)));
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
    let lastFrame: { x: number; y: number; width: number; height: number } | undefined;
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
        if (property === "setWindowFrame") return async (frame: { x: number; y: number; width: number; height: number }) => {
          // Only touch move()/setSize() when their inputs actually changed: calling
          // setSize() on every drag frame (even with unchanged dimensions) triggers a
          // WebView2 repaint glitch on Windows that leaves an artifact at the top edge.
          if (!lastFrame || frame.x !== lastFrame.x || frame.y !== lastFrame.y) {
            await neutralinoWindow.move(frame.x, frame.y);
          }
          if (!lastFrame || frame.width !== lastFrame.width || frame.height !== lastFrame.height) {
            await neutralinoWindow.setSize({ width: frame.width, height: frame.height });
          }
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
  const message = error instanceof Error ? error.message : String(error);
  const neutralinoGlobals = globalThis as typeof globalThis & { NL_PATH?: unknown };
  const applicationPath = typeof neutralinoGlobals.NL_PATH === "string" ? neutralinoGlobals.NL_PATH : undefined;
  return {
    phase: "backend handshake",
    operation: "connect",
    message,
    ...(applicationPath === undefined ? {} : {
      applicationPath,
      logPaths: [`${applicationPath}/neutralinojs.log`, `${applicationPath}/neutralino-backend.log`],
    }),
  };
}

function renderStartupFailure(failure: StartupFailure, mode: "terminal" | "slow" | "reconnecting" | "runtime"): void {
  document.getElementById("desktop-startup-failure")?.remove();
  const overlay = document.createElement("section");
  overlay.id = "desktop-startup-failure";
  overlay.setAttribute("role", "alert");
  const heading = mode === "slow"
    ? "Spirit Vale Overlay is still starting"
    : mode === "reconnecting" ? "Reconnecting to Spirit Vale Overlay"
      : mode === "runtime" ? "Spirit Vale Overlay disconnected" : "Spirit Vale Overlay could not start";
  const guidance = mode === "slow"
    ? "Startup is continuing automatically. Antivirus scanning, synchronized storage, or a busy drive can delay the bundled backend on first launch."
    : mode === "reconnecting" ? "The app is reconnecting automatically. Capture continues if the backend process is still available."
      : mode === "runtime" ? "Close this window and reopen Spirit Vale Overlay."
        : "Close the app, make sure the complete extracted folder is available and writable, then launch it again. Moving the complete folder to a reliable local location may resolve sync, permission, or antivirus locking failures.";
  overlay.innerHTML = `
    <style>
      #desktop-startup-failure{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:28px;background:#0c110e;color:#edf5ee;font:14px/1.45 system-ui,sans-serif}
      #desktop-startup-failure .card{width:min(680px,100%);padding:24px;border:1px solid #b95252;border-radius:14px;background:#171d19;box-shadow:0 18px 50px #0008}
      #desktop-startup-failure h1{margin:0 0 10px;font-size:22px}#desktop-startup-failure p{margin:8px 0;color:#c8d2ca}
      #desktop-startup-failure dl{display:grid;grid-template-columns:max-content 1fr;gap:5px 12px;margin:16px 0;padding:12px;border-radius:8px;background:#0f1511}
      #desktop-startup-failure dt{color:#91a095}#desktop-startup-failure dd{margin:0;overflow-wrap:anywhere}
      #desktop-startup-failure .actions{display:flex;gap:8px;margin-top:18px}#desktop-startup-failure button{padding:9px 13px;border:1px solid #667269;border-radius:7px;background:#252d27;color:#edf5ee;cursor:pointer}
    </style>
    <div class="card">
      <h1>${heading}</h1>
      <p>${escapeHtml(failure.message)}</p>
      <p>${guidance}</p>
      <dl>
        <dt>Phase</dt><dd>${escapeHtml(failure.phase)}</dd>
        ${failure.category ? `<dt>Category</dt><dd>${escapeHtml(failure.category)}</dd>` : ""}
        <dt>Operation</dt><dd>${escapeHtml(failure.operation)}</dd>
        ${failure.code ? `<dt>Error code</dt><dd>${escapeHtml(failure.code)}</dd>` : ""}
        ${failure.path ? `<dt>Path</dt><dd>${escapeHtml(failure.path)}</dd>` : ""}
        ${failure.logPaths?.length ? `<dt>Logs</dt><dd>${failure.logPaths.map(escapeHtml).join("<br>")}</dd>` : ""}
      </dl>
      <div class="actions">${failure.applicationPath ? '<button type="button" data-action="folder">Open application folder</button>' : ""}<button type="button" data-action="exit">Exit</button></div>
    </div>`;
  overlay.querySelector<HTMLButtonElement>('[data-action="folder"]')?.addEventListener("click", () => {
    if (failure.applicationPath) void os.open(failure.applicationPath);
  });
  overlay.querySelector<HTMLButtonElement>('[data-action="exit"]')?.addEventListener("click", () => void app.exit());
  document.body.append(overlay);
}

function escapeHtml(value: string): string {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
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
        const [position, size] = await Promise.all([neutralinoWindow.getPosition(), neutralinoWindow.getSize()]);
        if (x !== position.x || y !== position.y) await neutralinoWindow.move(x, y);
        if (width !== size.width || height !== size.height) result = await neutralinoWindow.setSize({ width, height });
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
