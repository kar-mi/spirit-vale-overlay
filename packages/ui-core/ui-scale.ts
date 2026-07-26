import type { BrowserWindow } from "electrobun/bun";

export const UI_SCALE_VALUES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export type UiScale = typeof UI_SCALE_VALUES[number];

let currentUiScale: UiScale = 1;
const windows = new Set<BrowserWindow>();

export function normalizeUiScale(value: unknown): UiScale {
  return UI_SCALE_VALUES.includes(value as UiScale) ? value as UiScale : 1;
}

export function getUiScale(): UiScale { return currentUiScale; }
export function scaledSize(value: number, scale = currentUiScale): number { return Math.ceil(value * scale); }
export function unscaledSize(value: number, scale = currentUiScale): number { return Math.ceil(value / scale); }

/** Registers a window for the launcher-wide CSS scale and live proportional resizing. */
export function registerUiScaleWindow(window: BrowserWindow, options: { scaleInitialFrame?: boolean } = {}): void {
  windows.add(window);
  if (options.scaleInitialFrame !== false && currentUiScale !== 1) resizeWindow(window, currentUiScale);
  window.webview.on("dom-ready", () => applyScale(window));
  window.on("close", () => { windows.delete(window); });
}

export function setUiScale(value: unknown): UiScale {
  const next = normalizeUiScale(value);
  const previous = currentUiScale;
  if (next === previous) return next;
  currentUiScale = next;
  const ratio = next / previous;
  for (const window of windows) {
    resizeWindow(window, ratio);
    applyScale(window);
  }
  return next;
}

function resizeWindow(window: BrowserWindow, ratio: number): void {
  const frame = window.getFrame();
  window.setSize(Math.ceil(frame.width * ratio), Math.ceil(frame.height * ratio));
}

function applyScale(window: BrowserWindow): void {
  window.webview.executeJavascript(`document.documentElement.style.zoom = ${currentUiScale};`);
}
