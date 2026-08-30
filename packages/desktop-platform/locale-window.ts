import type { BrowserWindow } from "@svoverlay/desktop-runtime";
import { backendLocale, setBackendLocale } from "@svoverlay/i18n/backend";
import type { LocaleCode } from "@svoverlay/i18n/locale";

import { DisposableStore, onWebviewEvent, onceWindowEvent, type Dispose } from "./window-lifecycle.ts";

const windows = new Set<BrowserWindow>();

export function getActiveLocale(): LocaleCode {
  return backendLocale();
}

export function registerLocaleWindow(window: BrowserWindow): Dispose {
  const lifecycle = new DisposableStore();
  windows.add(window);
  // The launcher is the root window and never goes through `launchWindow`, so no locale rides in on
  // its URL. Seeding on dom-ready covers it, and is a no-op for windows that arrived with one.
  lifecycle.add(onWebviewEvent(window.webview, "dom-ready", () => pushLocale(window, backendLocale())));
  lifecycle.add(() => { windows.delete(window); });
  lifecycle.add(onceWindowEvent(window, "close", () => lifecycle.dispose()));
  return () => lifecycle.dispose();
}

/**
 * New windows read the locale from their URL; already-open ones are told here. Views install
 * `__svoSetLocale` when they load, so a window that has not finished loading simply keeps the
 * language it was opened with until its dom-ready seeding runs.
 */
export function setActiveLocale(value: unknown): void {
  const previous = backendLocale();
  const locale = setBackendLocale(value);
  if (locale === previous) return;
  for (const window of windows) pushLocale(window, locale);
}

function pushLocale(window: BrowserWindow, locale: LocaleCode): void {
  window.webview.executeJavascript(`globalThis.__svoSetLocale?.(${JSON.stringify(locale)});`);
}
