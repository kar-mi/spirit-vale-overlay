import { beforeEach, expect, test } from "bun:test";

import DesktopRuntime from "@svoverlay/desktop-runtime";
import type { BrowserWindow } from "@svoverlay/desktop-runtime";

import { getActiveLocale, registerLocaleWindow, setActiveLocale } from "./locale-window.ts";

/**
 * English is the only registered locale, so `setActiveLocale` can never actually change and the
 * broadcast half of this module — pushing `__svoSetLocale` into already-open windows — cannot be
 * exercised here. Register a second locale in `@svoverlay/i18n/locale` and this file should grow a
 * test that a language change reaches every open window, and none that have closed.
 */

let nextId = 0;

/** Only the pieces `locale-window` touches: an id to address events at, and a script sink. */
function fakeWindow(): { window: BrowserWindow; scripts: string[]; id: string } {
  const id = `locale-test-${++nextId}`;
  const scripts: string[] = [];
  const window = {
    id,
    webview: { id: `${id}-webview`, executeJavascript: (script: string) => { scripts.push(script); } },
  } as unknown as BrowserWindow;
  return { window, scripts, id };
}

const domReady = (id: string): void => DesktopRuntime.events.emit(`dom-ready-${id}-webview`, { data: {} });
const closeWindow = (id: string): void => DesktopRuntime.events.emit(`close-${id}`, { data: {} });

beforeEach(() => { setActiveLocale("en"); });

test("seeds a window with the active locale once its view is ready", () => {
  // The launcher is the root window: it never goes through `launchWindow`, so no locale rides in on
  // its URL, and registration alone would leave it on whatever the signal defaulted to.
  const { window, scripts, id } = fakeWindow();
  registerLocaleWindow(window);
  expect(scripts).toEqual([]);

  domReady(id);
  expect(scripts).toEqual(['globalThis.__svoSetLocale?.("en");']);
});

test("normalizes an unknown language rather than pushing it", () => {
  setActiveLocale("qq");
  expect(getActiveLocale()).toBe("en");
});

test("stops seeding a window once it closes", () => {
  const { window, scripts, id } = fakeWindow();
  registerLocaleWindow(window);
  closeWindow(id);

  domReady(id);
  expect(scripts).toEqual([]);
});

test("stops seeding a window once its registration is disposed", () => {
  const { window, scripts, id } = fakeWindow();
  registerLocaleWindow(window)();

  domReady(id);
  expect(scripts).toEqual([]);
});
