import { describe, expect, test } from "bun:test";

import {
  classifyForegroundProcess,
  manuallySetVisibility,
  permitsGameKeybind,
  reconcileAutoHide,
  visibilityForForeground,
} from "./focus-policy.ts";

describe("overlay focus policy", () => {
  test("recognizes Spirit Vale case-insensitively", () => {
    expect(classifyForegroundProcess({ pid: 42, exeName: "SpiritVale.exe" }, 7)).toBe("game");
    expect(classifyForegroundProcess({ pid: 42, exeName: "SPIRITVALE.EXE" }, 7)).toBe("game");
  });

  test("recognizes this app by pid without requiring an image name", () => {
    expect(classifyForegroundProcess({ pid: 7 }, 7)).toBe("app");
  });

  test("distinguishes unrelated and unknown foreground processes", () => {
    expect(classifyForegroundProcess({ pid: 42, exeName: "explorer.exe" }, 7)).toBe("other");
    expect(classifyForegroundProcess({ pid: 42 }, 7)).toBe("unknown");
    expect(classifyForegroundProcess(undefined, 7)).toBe("unknown");
  });

  test("keeps the overlay visible for the game or app and preserves unknown state", () => {
    expect(visibilityForForeground("game")).toBe(true);
    expect(visibilityForForeground("app")).toBe(true);
    expect(visibilityForForeground("other")).toBe(false);
    expect(visibilityForForeground("unknown")).toBeUndefined();
  });

  test("permits game-only keybinds for the game and nothing else", () => {
    expect(permitsGameKeybind("game")).toBe(true);
    expect(permitsGameKeybind("app")).toBe(false);
    expect(permitsGameKeybind("other")).toBe(false);
    expect(permitsGameKeybind("unknown")).toBe(false);
  });

  test("manual hide takes priority until the user shows the overlay", () => {
    const hidden = manuallySetVisibility(false);
    expect(reconcileAutoHide(hidden, true, "game")).toEqual(hidden);
    expect(reconcileAutoHide(manuallySetVisibility(true), true, "game")).toEqual({
      visible: true,
      manualHideEngaged: false,
      autoHidden: false,
    });
  });

  test("auto-hide follows known focus and leaves unknown focus unchanged", () => {
    const visible = manuallySetVisibility(true);
    const autoHidden = reconcileAutoHide(visible, true, "other");
    expect(autoHidden).toEqual({ visible: false, manualHideEngaged: false, autoHidden: true });
    expect(reconcileAutoHide(autoHidden, true, "unknown")).toEqual(autoHidden);
    expect(reconcileAutoHide(autoHidden, true, "app")).toEqual(visible);
  });

  test("disabling auto-hide restores only an auto-hidden overlay", () => {
    const autoHidden = { visible: false, manualHideEngaged: false, autoHidden: true };
    expect(reconcileAutoHide(autoHidden, false, "unknown")).toEqual(manuallySetVisibility(true));
    const manuallyHidden = manuallySetVisibility(false);
    expect(reconcileAutoHide(manuallyHidden, false, "unknown")).toEqual(manuallyHidden);
  });
});
