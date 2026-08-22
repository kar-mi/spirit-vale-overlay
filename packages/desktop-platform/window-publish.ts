import path from "node:path";
import { PATHS, type BrowserWindow } from "@svoverlay/desktop-runtime";
import { applyRoundedCorners, setWindowIcon } from "./win32.ts";

export const appIconPath = path.join(PATHS.VIEWS_FOLDER, "assets/app-icon.ico");

export function mountRoundedWindow(window: BrowserWindow): void {
  applyRoundedCorners(window.ptr);
  setWindowIcon(window.ptr, appIconPath);
}

export function publishSafely(send: () => void): void {
  try {
    send();
  } catch {
    // The webview may still be completing its RPC handshake.
  }
}
