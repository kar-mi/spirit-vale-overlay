import { describe, expect, test } from "bun:test";

import { buildDamageChartRender, damageChartExtent, formatElapsedChartTime } from "./damage-chart.ts";
import type { MeterTimelinePoint } from "./app-types.ts";

const points: MeterTimelinePoint[] = [
  { elapsedMs: 5_000, damage: 50, cumulativeDamage: 50, dps: 10 },
  { elapsedMs: 10_000, damage: 100, cumulativeDamage: 150, dps: 20 },
  { elapsedMs: 15_000, damage: 25, cumulativeDamage: 175, dps: 5 },
];

describe("interactive combat chart projection", () => {
  test("uses the encounter duration and has no extent without data", () => {
    expect(damageChartExtent([], 20_000)).toBeUndefined();
    expect(damageChartExtent(points, 20_000)).toEqual({ start: 0, end: 20_000 });
    expect(damageChartExtent(points, 12_000)).toEqual({ start: 0, end: 15_000 });
  });

  test("filters to the zoom range and scales against visible DPS", () => {
    const render = buildDamageChartRender(points, { start: 7_000, end: 16_000 }, "dps", "Damage", "DPS");
    expect(render.points.map((point) => point.time)).toEqual([10_000, 15_000]);
    expect(render.points.map((point) => point.ratio)).toEqual([1, 0.25]);
    expect(render.points[0]?.primary).toContain("DPS");
  });

  test("keeps cumulative values absolute while rescaling the visible range", () => {
    const render = buildDamageChartRender(points, { start: 9_000, end: 16_000 }, "cumulative", "Healing", "HPS");
    expect(render.points.map((point) => point.ratio)).toEqual([150 / 175, 1]);
    expect(render.points[0]?.secondary).toBe("Cumulative healing");
  });

  test("formats encounter-relative timestamps", () => {
    expect(formatElapsedChartTime(0)).toBe("0:00");
    expect(formatElapsedChartTime(65_000)).toBe("1:05");
    expect(formatElapsedChartTime(3_665_000)).toBe("1:01:05");
  });
});
