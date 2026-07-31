import { describe, expect, test } from "bun:test";

import { buildXpEwmaTrend } from "./xp-ewma-trend.ts";

describe("overlay XP EWMA trend", () => {
  test("uses the tracker's 20-second decay across idle time", () => {
    const points = buildXpEwmaTrend(
      [{ atMs: 0, experience: 200 }],
      { start: 0, end: 40_000 },
    );

    expect(points[0]?.value).toBeCloseTo(10);
    expect(points.find((point) => point.time === 20_000)?.value).toBeCloseTo(10 / Math.E);
    expect(points.at(-1)?.value).toBeCloseTo(10 / Math.E ** 2);
  });

  test("seeds the visible range with earlier buckets and includes later gains", () => {
    const points = buildXpEwmaTrend(
      [
        { atMs: 0, experience: 200 },
        { atMs: 30_000, experience: 100 },
      ],
      { start: 20_000, end: 40_000 },
    );

    expect(points[0]?.value).toBeCloseTo(10 / Math.E);
    expect(points.find((point) => point.time === 30_000)?.value).toBeCloseTo(10 / Math.exp(1.5) + 5);
    expect(points.at(-1)?.value).toBeCloseTo((10 / Math.exp(1.5) + 5) / Math.exp(0.5));
  });
});
