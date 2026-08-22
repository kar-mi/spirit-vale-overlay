import { describe, expect, test } from "bun:test";

import { formatBytes, formatMeasuredAt } from "./format.ts";

describe("formatBytes", () => {
  test("keeps bytes whole and steps up through the units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1_024)).toBe("1.0 KB");
    expect(formatBytes(1_536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(2 * 1024 ** 4)).toBe("2.0 TB");
  });

  test("drops the decimal once the number is three digits", () => {
    expect(formatBytes(1_000_142_336)).toBe("954 MB");
    expect(formatBytes(99 * 1024 * 1024)).toBe("99.0 MB");
  });

  test("stops at the largest unit rather than inventing one", () => {
    expect(formatBytes(5_000 * 1024 ** 4)).toBe("5000 TB");
  });

  test("refuses to render a nonsense size", () => {
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatMeasuredAt", () => {
  const now = new Date("2026-08-07T18:30:00.000Z");

  test("shows only the time for a measurement taken today", () => {
    const formatted = formatMeasuredAt("2026-08-07T09:15:00.000Z", now);
    expect(formatted).not.toMatch(/[A-Za-z]{3}\s\d/);
    expect(formatted).toMatch(/\d/);
  });

  test("includes the date once the measurement is from another day", () => {
    expect(formatMeasuredAt("2026-08-05T09:15:00.000Z", now)).toMatch(/[A-Za-z]{3}\s\d+\s/);
  });

  test("says so rather than rendering an invalid date", () => {
    expect(formatMeasuredAt("not a date", now)).toBe("unknown");
  });
});
