import type { WindowFrame } from "./window-chrome.ts";

const INITIAL_SIZE_CHECKED_KEY = "svoverlay.initial-window-size-checked";

export interface WindowFrameRequests {
  getWindowFrame(params: Record<string, never>): Promise<WindowFrame>;
  setWindowFrame(frame: WindowFrame): Promise<unknown>;
}

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
