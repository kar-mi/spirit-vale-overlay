import { expect, test } from "bun:test";

import { xpToLevelUp } from "./xp-to-level.ts";

test("calculates the remaining experience for the current level", () => {
  expect(xpToLevelUp(2, 46, [40, 196, 500])).toBe(150);
});

test("clamps completed progress and rejects unavailable levels", () => {
  expect(xpToLevelUp(1, 50, [40])).toBe(0);
  expect(xpToLevelUp(2, 0, [40])).toBeUndefined();
});

test("rejects invalid character progress", () => {
  expect(xpToLevelUp(0, 0, [40])).toBeUndefined();
  expect(xpToLevelUp(1, -1, [40])).toBeUndefined();
});
