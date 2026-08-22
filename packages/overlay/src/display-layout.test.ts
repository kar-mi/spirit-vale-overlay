import { describe, expect, test } from "bun:test";

import {
  displayForRect,
  displayKey,
  displaysNeedingSurface,
  elementsForDisplay,
  resolveElementDisplayKey,
  resolveHomeDisplayKey,
  type OverlayDisplay,
} from "./display-layout.ts";
import type { OverlayElementId, OverlayElementSettings } from "./app-types.ts";

const primary: OverlayDisplay = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, isPrimary: true };
const secondary: OverlayDisplay = { bounds: { x: 1920, y: -120, width: 2560, height: 1440 } };
const displays = [primary, secondary];
const primaryKey = displayKey(primary);
const secondaryKey = displayKey(secondary);

describe("display keys", () => {
  test("derives a key from bounds rather than the native display id", () => {
    expect(primaryKey).toBe("1920x1080@0,0");
    expect(secondaryKey).toBe("2560x1440@1920,-120");
  });

  test("rounds fractional bounds so a key stays comparable", () => {
    expect(displayKey({ bounds: { x: 0.4, y: -0.6, width: 1919.5, height: 1080.2 } })).toBe("1920x1080@0,-1");
  });

  test("distinguishes identical panels by position", () => {
    const left: OverlayDisplay = { bounds: { x: 0, y: 0, width: 2560, height: 1440 } };
    const right: OverlayDisplay = { bounds: { x: 2560, y: 0, width: 2560, height: 1440 } };

    expect(displayKey(left)).not.toBe(displayKey(right));
  });
});

describe("home display resolution", () => {
  test("falls back to the primary display when unset", () => {
    expect(resolveHomeDisplayKey(displays, "")).toBe(primaryKey);
  });

  test("falls back to the primary display when the stored monitor is gone", () => {
    expect(resolveHomeDisplayKey(displays, "1280x720@9000,9000")).toBe(primaryKey);
  });

  test("keeps a stored non-primary home display", () => {
    expect(resolveHomeDisplayKey(displays, secondaryKey)).toBe(secondaryKey);
  });

  test("uses the first display when none is flagged primary", () => {
    expect(resolveHomeDisplayKey([secondary, { bounds: { x: 0, y: 0, width: 800, height: 600 } }], "")).toBe(secondaryKey);
  });

  test("returns the stored key unchanged when there are no displays to resolve against", () => {
    expect(resolveHomeDisplayKey([], secondaryKey)).toBe(secondaryKey);
  });
});

describe("element display resolution", () => {
  test("keeps an assignment whose monitor is still connected", () => {
    expect(resolveElementDisplayKey(displays, secondaryKey, primaryKey)).toBe(secondaryKey);
  });

  test("falls back to home when the assigned monitor is unplugged", () => {
    expect(resolveElementDisplayKey(displays, "1280x720@9000,9000", primaryKey)).toBe(primaryKey);
  });

  test("falls back to home when nothing is assigned", () => {
    expect(resolveElementDisplayKey(displays, "", secondaryKey)).toBe(secondaryKey);
  });
});

describe("drop targets", () => {
  test("keeps a tile on the display showing most of it", () => {
    expect(displayForRect(displays, { x: 1820, y: 100, width: 400, height: 200 })).toBe(secondary);
    expect(displayForRect(displays, { x: 1620, y: 100, width: 400, height: 200 })).toBe(primary);
  });

  test("picks the display a tile is fully inside", () => {
    expect(displayForRect(displays, { x: 40, y: 40, width: 200, height: 120 })).toBe(primary);
    expect(displayForRect(displays, { x: 2400, y: 40, width: 200, height: 120 })).toBe(secondary);
  });

  test("falls back to the nearest display for a drop into a dead zone", () => {
    expect(displayForRect(displays, { x: 200, y: 1400, width: 200, height: 120 })).toBe(primary);
  });

  test("returns nothing when there are no displays", () => {
    expect(displayForRect([], { x: 0, y: 0, width: 10, height: 10 })).toBeUndefined();
  });
});

describe("surfaces and grouping", () => {
  const elements = {
    partyRanking: element({ enabled: true, display: primaryKey }),
    health: element({ enabled: true, display: secondaryKey }),
    mana: element({ enabled: false, display: secondaryKey }),
    weight: element({ enabled: false, display: "1280x720@9000,9000" }),
  } as unknown as Record<OverlayElementId, OverlayElementSettings>;

  test("wants a surface only for displays holding an enabled element", () => {
    expect(displaysNeedingSurface(elements).sort()).toEqual([primaryKey, secondaryKey].sort());
  });

  test("wants no surface at all when every element is disabled", () => {
    const allOff = Object.fromEntries(
      Object.entries(elements).map(([id, value]) => [id, { ...value, enabled: false }]),
    ) as Record<OverlayElementId, OverlayElementSettings>;

    expect(displaysNeedingSurface(allOff)).toEqual([]);
  });

  test("gives each surface only its own elements, disabled ones included", () => {
    expect(Object.keys(elementsForDisplay(elements, secondaryKey))).toEqual(["health", "mana"]);
    expect(Object.keys(elementsForDisplay(elements, primaryKey))).toEqual(["partyRanking"]);
  });
});

function element(overrides: Partial<OverlayElementSettings>): OverlayElementSettings {
  return { enabled: true, opacity: 1, x: 0, y: 0, width: 200, height: 120, display: "", ...overrides };
}
