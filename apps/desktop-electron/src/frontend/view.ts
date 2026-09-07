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
import type { SpiritValeBridge } from "../main/preload.ts";

declare global {
  interface Window { spiritVale: SpiritValeBridge }
}

export { watchBackendReconnecting };

const SLOW_BACKEND_MS = 10_000;

let ready: Promise<BackendReady> | undefined;
let rejectReady: ((error: Error) => void) | undefined;
let disposeReady: (() => void) | undefined;
let readyTimer: ReturnType<typeof setTimeout> | undefined;

const bridge: ShellFrontendBridge = {
  awaitConnection: (onSlow) => {
    // Child windows carry their port/ticket in the URL; only the launcher waits on the IPC broadcast.
    const fromSearch = backendConnectionFromSearch(location.search);
    if (fromSearch) return Promise.resolve(fromSearch);
    ready ??= new Promise<BackendReady>((resolve, reject) => {
      rejectReady = reject;
      readyTimer = setTimeout(() => onSlow({
        phase: "backend handshake",
        operation: "connect",
        message: "The desktop backend is taking longer than expected. Required files may be delayed or temporarily blocked.",
      }), SLOW_BACKEND_MS);
      disposeReady = window.spiritVale.onBackendReady((payload) => {
        if (readyTimer !== undefined) clearTimeout(readyTimer);
        readyTimer = undefined;
        rejectReady = undefined;
        disposeReady?.();
        disposeReady = undefined;
        resolve(payload);
      });
    });
    return ready;
  },
  reset: () => {
    if (readyTimer !== undefined) clearTimeout(readyTimer);
    readyTimer = undefined;
    disposeReady?.();
    disposeReady = undefined;
    rejectReady = undefined;
    ready = undefined;
  },
  onFatal: (handler) => window.spiritVale.onBackendFatal((payload) => {
    const failure = payload as StartupFailure;
    if (readyTimer !== undefined) clearTimeout(readyTimer);
    readyTimer = undefined;
    disposeReady?.();
    disposeReady = undefined;
    rejectReady?.(new StartupFailureError(failure));
    rejectReady = undefined;
    handler(failure);
  }),
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
    return defineRpc<Schema, "webview">("webview", config as never) as RpcInstance<Schema, "webview">;
  }
}

export default { DesktopView };
