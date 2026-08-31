import { expect, test } from "bun:test";

import { historyScanLimit, normalizeHistorySessionLimit } from "./history-limit.ts";

test("normalizes history session limits and derives the empty-session scan allowance", () => {
  expect(normalizeHistorySessionLimit(undefined)).toBe(100);
  expect(normalizeHistorySessionLimit(99)).toBe(100);
  expect(normalizeHistorySessionLimit(250.6)).toBe(251);
  expect(normalizeHistorySessionLimit(50_000)).toBe(50_000);
  expect(normalizeHistorySessionLimit(200_000)).toBe(100_000);
  expect(historyScanLimit(250)).toBe(750);
});
