import { describe, expect, test } from "bun:test";

import { validateMarketUiFilters } from "./filter-model.ts";

describe("market UI filters", () => {
  test("accepts presence-only and inclusive range filters", () => {
    expect(validateMarketUiFilters([
      { stat: 0 },
      { stat: 15, minValue: 5, maxValue: 9 },
    ], 220)).toEqual([
      { stat: 0 },
      { stat: 15, minValue: 5, maxValue: 9 },
    ]);
  });

  test("rejects invalid, duplicate, and inverted filters", () => {
    expect(() => validateMarketUiFilters([{ stat: 220 }], 220)).toThrow("unknown");
    expect(() => validateMarketUiFilters([{ stat: 0 }, { stat: 0 }], 220)).toThrow("duplicate");
    expect(() => validateMarketUiFilters([{ stat: 0, minValue: 2, maxValue: 1 }], 220)).toThrow("exceeds");
    expect(() => validateMarketUiFilters([{ stat: 0, minValue: Number.NaN }], 220)).toThrow("finite");
  });
});
