import type { BrowserWindow } from "electrobun/bun";

import {
  getUiScale,
  setUiScaleValue,
  type UiScale,
} from "./ui-scale.ts";
import { DisposableStore, onWebviewEvent, onceWindowEvent, type Dispose } from "./window-lifecycle.ts";

export { getUiScale, normalizeUiScale, scaledSize, unscaledSize } from "./ui-scale.ts";
export type { UiScale } from "./ui-scale.ts";

const windows = new Set<BrowserWindow>();

export function registerUiScaleWindow(window: BrowserWindow, options: { scaleInitialFrame?: boolean } = {}): Dispose {
  const lifecycle = new DisposableStore();
  windows.add(window);
  if (options.scaleInitialFrame !== false && getUiScale() !== 1) resizeWindow(window, getUiScale());
  lifecycle.add(onWebviewEvent(window.webview, "dom-ready", () => applyScale(window)));
  lifecycle.add(() => { windows.delete(window); });
  lifecycle.add(onceWindowEvent(window, "close", () => lifecycle.dispose()));
  return () => lifecycle.dispose();
}

export function setUiScale(value: unknown): UiScale {
  const { next, previous } = setUiScaleValue(value);
  if (next === previous) return next;
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
  window.webview.executeJavascript(`document.documentElement.style.zoom = ${getUiScale()};`);
}
