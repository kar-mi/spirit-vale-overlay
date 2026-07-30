import { describe, expect, test } from "bun:test";

import { activeDeathLogSource } from "./combat-navigation.ts";

describe("combat screen death-log routing", () => {
  test("routes live only when a live file is available", () => {
    expect(activeDeathLogSource("live", "selector", true)).toBe("live");
    expect(activeDeathLogSource("live", "analysis", false)).toBeUndefined();
  });

  test("routes past only from a loaded analysis", () => {
    expect(activeDeathLogSource("past", "analysis", false)).toBe("past");
    expect(activeDeathLogSource("past", "selector", true)).toBeUndefined();
  });
});
