import { describe, expect, test } from "bun:test";

import { weightWarnLevel } from "./weight-warning.ts";

describe("overlay weight warning", () => {
  test("stays quiet below three quarters of maximum", () => {
    expect(weightWarnLevel(undefined)).toBeUndefined();
    expect(weightWarnLevel({ current: 0, maximum: 2_000 })).toBeUndefined();
    expect(weightWarnLevel({ current: 1_499, maximum: 2_000 })).toBeUndefined();
  });

  test("cautions from exactly 75% up to and including 90%", () => {
    expect(weightWarnLevel({ current: 1_500, maximum: 2_000 })).toBe("caution");
    expect(weightWarnLevel({ current: 1_800, maximum: 2_000 })).toBe("caution");
  });

  test("escalates to danger only past 90%, including overweight", () => {
    expect(weightWarnLevel({ current: 1_801, maximum: 2_000 })).toBe("danger");
    expect(weightWarnLevel({ current: 2_400, maximum: 2_000 })).toBe("danger");
  });

  test("never warns against a zero maximum", () => {
    expect(weightWarnLevel({ current: 10, maximum: 0 })).toBeUndefined();
  });
});
