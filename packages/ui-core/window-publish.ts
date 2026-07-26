import type { BrowserWindow } from "electrobun/bun";
import { applyRoundedCorners } from "./win32.ts";

/** Applies the frameless-window rounded-corner hint to a newly created window. */
export function mountRoundedWindow(window: BrowserWindow): void {
  applyRoundedCorners(window.ptr);
}

/** Sends an RPC state push, swallowing the error from a webview that hasn't finished its RPC handshake yet. */
export function publishSafely(send: () => void): void {
  try {
    send();
  } catch {
    // The webview may still be completing its RPC handshake.
  }
}
