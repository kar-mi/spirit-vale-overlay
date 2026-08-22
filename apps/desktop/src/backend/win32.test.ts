import { describe, expect, test } from "bun:test";

import { overlayExtendedStylesReady } from "./win32.ts";

const TOPMOST = 0x00000008;
const TRANSPARENT = 0x00000020;
const TOOLWINDOW = 0x00000080;
const APPWINDOW = 0x00040000;
const LAYERED = 0x00080000;
const NOACTIVATE = 0x08000000;

describe("Neutralino overlay extended styles", () => {
  test("accepts a locked transparent, click-through tool window", () => {
    expect(overlayExtendedStylesReady(TOPMOST | TRANSPARENT | TOOLWINDOW | LAYERED | NOACTIVATE, true)).toBeTrue();
  });

  test("rejects Neutralino's transient styles before pass-through setup sticks", () => {
    expect(overlayExtendedStylesReady(TOPMOST | LAYERED, true)).toBeFalse();
  });

  test("accepts an unlocked interactive tool window", () => {
    expect(overlayExtendedStylesReady(TOPMOST | TOOLWINDOW | LAYERED, false)).toBeTrue();
    expect(overlayExtendedStylesReady(TOPMOST | TOOLWINDOW | APPWINDOW | LAYERED, false)).toBeFalse();
  });
});
