import type { WindowFrame } from "./window-chrome.ts";

const INITIAL_SIZE_CHECKED_KEY = "svoverlay.initial-window-size-checked";

export interface WindowFrameRequests {
  getWindowFrame(params: Record<string, never>): Promise<WindowFrame>;
  setWindowFrame(frame: WindowFrame): Promise<unknown>;
}

/**
 * The native frame handed to `new BrowserWindow` isn't scaled for `devicePixelRatio`, so on a
 * scaled display the page renders larger than the window until something resizes it. Call once on
 * load with the window's minimum content size; it force-resizes only if the native frame is too
 * small to hold that minimum at the current DPI scale.  Do not use a preferred/default size here:
 * users may have deliberately resized a persisted window below that size. The check is performed
 * once per window session, so a renderer reload cannot resize an already-open window again.
 */
export async function ensureInitialWindowSize(
  requests: WindowFrameRequests | undefined,
  minimumSize: { width: number; height: number },
): Promise<void> {
  if (!requests) return;
  if (sessionStorage.getItem(INITIAL_SIZE_CHECKED_KEY)) return;
  const frame = await requests.getWindowFrame({});
  const scale = window.devicePixelRatio || 1;
  const width = Math.max(frame.width, Math.ceil(minimumSize.width * scale));
  const height = Math.max(frame.height, Math.ceil(minimumSize.height * scale));
  if (width !== frame.width || height !== frame.height) {
    await requests.setWindowFrame({ ...frame, width, height });
  }
  sessionStorage.setItem(INITIAL_SIZE_CHECKED_KEY, "true");
}
