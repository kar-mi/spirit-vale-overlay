import { describe, expect, test } from "bun:test";

import { ShortcutMatcher } from "./pass-through-shortcuts.ts";

describe("pass-through shortcut matcher", () => {
  test("matches a plain key once per physical press", () => {
    const matcher = new ShortcutMatcher<"reset">();
    matcher.setBindings([{ action: "reset", shortcut: "F5" }]);

    expect(matcher.handleKey(0x74, true)).toBe("reset");
    expect(matcher.handleKey(0x74, true)).toBeUndefined();
    expect(matcher.handleKey(0x74, false)).toBeUndefined();
    expect(matcher.handleKey(0x74, true)).toBe("reset");
  });

  test("requires the exact configured modifiers", () => {
    const matcher = new ShortcutMatcher<"lock">();
    matcher.setBindings([{ action: "lock", shortcut: "Ctrl+Shift+F11" }]);

    matcher.handleKey(0x11, true); // Ctrl
    expect(matcher.handleKey(0x7a, true)).toBeUndefined();
    matcher.handleKey(0x7a, false);
    matcher.handleKey(0x10, true); // Shift
    expect(matcher.handleKey(0x7a, true)).toBe("lock");
  });

  test("does not match while bindings are suspended and adopts replacement bindings", () => {
    const matcher = new ShortcutMatcher<"show">();
    matcher.setBindings([]);
    expect(matcher.handleKey(0x78, true)).toBeUndefined();
    matcher.handleKey(0x78, false);

    matcher.setBindings([{ action: "show", shortcut: "F9" }]);
    expect(matcher.handleKey(0x78, true)).toBe("show");
  });
});
