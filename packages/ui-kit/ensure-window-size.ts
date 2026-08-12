import type { WindowFrame } from "./window-chrome.ts";

export interface WindowFrameRequests {
  getWindowFrame(params: Record<string, never>): Promise<WindowFrame>;
  setWindowFrame(frame: WindowFrame): Promise<unknown>;
}

/**
 * The native frame handed to `new BrowserWindow` isn't scaled for `devicePixelRatio`, so on a
 * scaled display the page renders larger than the window until something resizes it. Call once on
 * load with the window's intended default size; it force-resizes only if the native frame is too
 * small to hold that size at the current DPI scale.
 */
export async function ensureInitialWindowSize(
  requests: WindowFrameRequests | undefined,
  defaultSize: { width: number; height: number },
): Promise<void> {
  if (!requests) return;
  const frame = await requests.getWindowFrame({});
  const scale = window.devicePixelRatio || 1;
  const width = Math.max(frame.width, Math.ceil(defaultSize.width * scale));
  const height = Math.max(frame.height, Math.ceil(defaultSize.height * scale));
  if (width === frame.width && height === frame.height) return;
  await requests.setWindowFrame({ ...frame, width, height });
}
