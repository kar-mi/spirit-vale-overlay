import { expect, test } from "bun:test";

import { normalizeUiScale, scaledSize, unscaledSize } from "./ui-scale.ts";

test("UI scale only accepts supported presets", () => {
  expect(normalizeUiScale(0.75)).toBe(0.75);
  expect(normalizeUiScale(2)).toBe(2);
  expect(normalizeUiScale(1.1)).toBe(1);
  expect(normalizeUiScale("1.5")).toBe(1);
});

test("frame dimensions scale and unscale predictably", () => {
  expect(scaledSize(640, 1.5)).toBe(960);
  expect(unscaledSize(960, 1.5)).toBe(640);
});
