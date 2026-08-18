import { describe, expect, test } from "bun:test";

import { shortcutFromKeyboardEvent } from "./shortcut-from-keyboard-event.ts";

function keyboardEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: "",
    code: "",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("shortcutFromKeyboardEvent", () => {
  test("records shifted top-row digits by physical key instead of produced symbol", () => {
    expect(shortcutFromKeyboardEvent(keyboardEvent({
      key: "!", code: "Digit1", ctrlKey: true, shiftKey: true,
    }))).toBe("Ctrl+Shift+1");
    expect(shortcutFromKeyboardEvent(keyboardEvent({
      key: "\u00a7", code: "Digit3", ctrlKey: true, shiftKey: true,
    }))).toBe("Ctrl+Shift+3");
  });

  test("records every supported top-row digit", () => {
    for (let digit = 0; digit <= 9; digit++) {
      expect(shortcutFromKeyboardEvent(keyboardEvent({
        key: String(digit), code: `Digit${digit}`, ctrlKey: true, shiftKey: true,
      }))).toBe(`Ctrl+Shift+${digit}`);
    }
  });

  test("keeps canonical modifier ordering and supported non-digit keys", () => {
    expect(shortcutFromKeyboardEvent(keyboardEvent({
      key: "a", code: "KeyA", ctrlKey: true, altKey: true, shiftKey: true, metaKey: true,
    }))).toBe("Ctrl+Alt+Shift+Meta+A");
    expect(shortcutFromKeyboardEvent(keyboardEvent({ key: "F12", code: "F12" }))).toBe("F12");
    expect(shortcutFromKeyboardEvent(keyboardEvent({ key: "ArrowLeft", code: "ArrowLeft" }))).toBe("ArrowLeft");
  });

  test("ignores modifier-only, unsupported, and numpad events", () => {
    expect(shortcutFromKeyboardEvent(keyboardEvent({ key: "Shift", code: "ShiftLeft", shiftKey: true }))).toBeUndefined();
    expect(shortcutFromKeyboardEvent(keyboardEvent({ key: "!", code: "Numpad1", shiftKey: true }))).toBeUndefined();
    expect(shortcutFromKeyboardEvent(keyboardEvent({ key: "Insert", code: "Insert" }))).toBeUndefined();
  });
});
