import type { DesktopRPCSchema } from "@svoverlay/contracts/rpc";
import type { BackendReady, StartupFailure } from "@svoverlay/desktop/src/shared/protocol.ts";
import { backendConnectionFromSearch } from "@svoverlay/desktop/src/shared/backend-connection.ts";
import { defineRpc, type RpcInstance } from "@svoverlay/desktop/src/shared/rpc.ts";
import {
  DesktopTransport,
  StartupFailureError,
  watchBackendReconnecting,
  type ShellFrontendBridge,
} from "@svoverlay/desktop/src/frontend/backend-transport.ts";
import type { SpiritValeBridge, WindowFrame } from "../main/preload.ts";

declare global {
  interface Window { spiritVale: SpiritValeBridge }
}

export { watchBackendReconnecting };

const SLOW_BACKEND_MS = 10_000;

let ready: Promise<BackendReady> | undefined;

const bridge: ShellFrontendBridge = {
  awaitConnection: (onSlow) => {
    // Child windows carry their port/ticket in the URL; only the launcher waits on the IPC broadcast.
    const fromSearch = backendConnectionFromSearch(location.search);
    if (fromSearch) return Promise.resolve(fromSearch);
    ready ??= new Promise<BackendReady>((resolve, reject) => {
      const timer = setTimeout(() => onSlow({
        phase: "backend handshake",
        operation: "connect",
        message: "The desktop backend is taking longer than expected. Required files may be delayed or temporarily blocked.",
      }), SLOW_BACKEND_MS);
      window.spiritVale.onBackendReady((payload) => { clearTimeout(timer); resolve(payload); });
      window.spiritVale.onBackendFatal((payload) => {
        clearTimeout(timer);
        reject(new StartupFailureError(payload as StartupFailure));
      });
    });
    return ready;
  },
  reset: () => { ready = undefined; },
  failureActions: {
    openApplicationFolder: (target) => void window.spiritVale.openPath(target),
    quitApplication: () => void window.spiritVale.quit(),
  },
};

const transport = new DesktopTransport(bridge);

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

export default { DesktopView };
