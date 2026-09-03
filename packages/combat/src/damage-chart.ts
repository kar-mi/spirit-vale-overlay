import type { ChartRange, ChartRenderResult } from "@svoverlay/ui-kit/interactive-chart";
import { formatCompact } from "@svoverlay/ui-kit/format";
import type { MeterTimelinePoint } from "./app-types.ts";

export type DamageChartMetric = "cumulative" | "dps";

export function damageChartExtent(
  points: readonly MeterTimelinePoint[],
  durationMs: number,
): ChartRange | undefined {
  if (points.length === 0) return undefined;
  return { start: 0, end: Math.max(1, durationMs, points.at(-1)?.elapsedMs ?? 0) };
}

export function buildDamageChartRender(
  points: readonly MeterTimelinePoint[],
  range: ChartRange,
  metric: DamageChartMetric,
  damageLabel: string,
  metricLabel: string,
): ChartRenderResult {
  const visible = points.filter((point) => point.elapsedMs >= range.start && point.elapsedMs <= range.end);
  const maximum = visible.reduce(
    (highest, point) => Math.max(highest, metric === "cumulative" ? point.cumulativeDamage : point.dps),
    0,
  );
  return {
    points: visible.map((point) => {
      const value = metric === "cumulative" ? point.cumulativeDamage : point.dps;
      return {
        time: point.elapsedMs,
        ratio: maximum > 0 ? value / maximum : 0,
        primary: metric === "cumulative"
          ? formatCompact(value)
          : `${formatCompact(value)} ${metricLabel}`,
        secondary: metric === "cumulative" ? `Cumulative ${damageLabel.toLowerCase()}` : `${damageLabel} per second`,
      };
    }),
    yLabels: Array.from({ length: 5 }, (_, tick) => formatCompact((maximum * tick) / 4)),
  };
}

export function formatElapsedChartTime(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}
