import type { BrowserWindow } from "@svoverlay/desktop-runtime";
import { backendLocale, setBackendLocale } from "@svoverlay/i18n/backend";
import type { LocaleCode } from "@svoverlay/i18n/locale";

import { DisposableStore, onceWindowEvent, type Dispose } from "./window-lifecycle.ts";

const windows = new Set<BrowserWindow>();

export function getActiveLocale(): LocaleCode {
  return backendLocale();
}

export function registerLocaleWindow(window: BrowserWindow): Dispose {
  const lifecycle = new DisposableStore();
  windows.add(window);
  lifecycle.add(() => { windows.delete(window); });
  lifecycle.add(onceWindowEvent(window, "close", () => lifecycle.dispose()));
  return () => lifecycle.dispose();
}

/**
 * New windows read the locale from their URL; already-open ones are told here. Views install
 * `__svoSetLocale` when they load, so a window that has not finished loading simply keeps the
 * language it was opened with.
 */
export function setActiveLocale(value: unknown): void {
  const previous = backendLocale();
  const locale = setBackendLocale(value);
  if (locale === previous) return;
  const script = `globalThis.__svoSetLocale?.(${JSON.stringify(locale)});`;
  for (const window of windows) window.webview.executeJavascript(script);
}
