import path from "node:path";
import { PATHS, type BrowserWindow } from "electrobun/bun";
import { applyRoundedCorners, setWindowIcon } from "./win32.ts";

/** Filesystem path to the app icon bundled into every Electrobun view folder. */
export const appIconPath = path.join(PATHS.VIEWS_FOLDER, "assets/app-icon.ico");

/** Applies the frameless-window rounded-corner hint to a newly created window. */
export function mountRoundedWindow(window: BrowserWindow): void {
  applyRoundedCorners(window.ptr);
  setWindowIcon(window.ptr, appIconPath);
}

/** Sends an RPC state push, swallowing the error from a webview that hasn't finished its RPC handshake yet. */
export function publishSafely(send: () => void): void {
  try {
    send();
  } catch {
    // The webview may still be completing its RPC handshake.
  }
}
