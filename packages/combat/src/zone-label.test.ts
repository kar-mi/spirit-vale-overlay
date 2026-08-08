import { expect, test } from "bun:test";

import { formatZone, formatZoneSummary } from "./zone-label.ts";

test("formats known and unknown map IDs", () => {
  expect(formatZone(1)).toBe("Nevaris");
  expect(formatZone(48)).toBe("The Echoing Spire");
  expect(formatZone(999)).toBe("Zone 999");
});

test("summarizes a session from its latest distinct zone", () => {
  expect(formatZoneSummary([])).toBeUndefined();
  expect(formatZoneSummary([48])).toBe("The Echoing Spire");
  expect(formatZoneSummary([48, 29, 48])).toBe("The Echoing Spire +2");
});
