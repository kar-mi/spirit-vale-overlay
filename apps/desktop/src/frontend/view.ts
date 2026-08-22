import { app, events, init, os, window as neutralinoWindow } from "@neutralinojs/lib";
import type { DesktopRPCSchema } from "@svoverlay/contracts/rpc";

import type { BackendReady, ClientPacket, RpcPacket, ServerPacket } from "../shared/protocol.ts";
import { backendConnectionFromSearch } from "../shared/backend-connection.ts";
import { defineRpc, type RpcInstance } from "../shared/rpc.ts";

type Handler = (packet: RpcPacket) => void;

class DesktopTransport {
  private socket?: WebSocket;
  private handler?: Handler;
  private readonly queued: RpcPacket[] = [];

  constructor() {
    init();
    void this.connect();
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
    const connection = await backendConnection();
    const socket = new WebSocket(`ws://127.0.0.1:${connection.port}/rpc`);
    this.socket = socket;
    socket.addEventListener("open", async () => {
      const processId = await app.getProcessId().catch(() => undefined);
      socket.send(JSON.stringify({ kind: "hello", ticket: connection.ticket, processId } satisfies ClientPacket));
    });
    socket.addEventListener("message", (event) => void this.receive(String(event.data)));
    socket.addEventListener("close", () => this.fail("The desktop backend disconnected."));
    socket.addEventListener("error", () => this.fail("The desktop backend connection failed."));
  }

  private async receive(serialized: string): Promise<void> {
    let packet: ServerPacket;
    try {
      packet = JSON.parse(serialized) as ServerPacket;
    } catch {
      return;
    }
    if (packet.kind === "ready") {
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
    if (packet.kind === "fatal") this.fail(packet.message);
  }

  private fail(message: string): void {
    console.error(message);
    document.body.dataset["backendError"] = message;
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
        if (property === "windowAction") return async ({ action }: { action: "minimize" | "close" }) => {
          if (action === "minimize") await neutralinoWindow.minimize();
          else await app.exit();
        };
        if (property === "getWindowFrame") return async () => {
          const [position, size] = await Promise.all([neutralinoWindow.getPosition(), neutralinoWindow.getSize()]);
          return { ...position, ...size };
        };
        if (property === "setWindowFrame") return async (frame: { x: number; y: number; width: number; height: number }) => {
          await neutralinoWindow.move(frame.x, frame.y);
          await neutralinoWindow.setSize({ width: frame.width, height: frame.height });
        };
        return Reflect.get(target, property, receiver);
      },
    }) as typeof rpc.request;
    return { ...rpc, request, proxy: { ...rpc.proxy, request } } as RpcInstance<Schema, "webview">;
  }
}

async function backendConnection(): Promise<BackendReady> {
  const connection = backendConnectionFromSearch(location.search);
  if (connection) return connection;

  return new Promise((resolve) => {
    void events.on("desktopBackendReady", (event) => resolve(event.detail as BackendReady));
  });
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
        await neutralinoWindow.move(Number(value?.["x"]), Number(value?.["y"]));
        result = await neutralinoWindow.setSize({ width: Number(value?.["width"]), height: Number(value?.["height"]) });
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
