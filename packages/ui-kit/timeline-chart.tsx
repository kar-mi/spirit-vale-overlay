import { formatCompact, formatDuration } from "./format.ts";

export interface TimelineChartPoint {
  elapsedMs: number;
  value: number;
}

export interface TimelineChartProps {
  points: readonly TimelineChartPoint[];
  durationMs: number;
  label: string;
  className?: string;
  width?: number;
  height?: number;
  layout?: TimelineChartLayout;
  bottomLabelOffset?: number;
}

export interface TimelineChartLayout {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function timelineCoordinates(
  points: readonly TimelineChartPoint[],
  durationMs: number,
  width: number,
  height: number,
  layout: TimelineChartLayout,
): string {
  const maximum = Math.max(1, ...points.map((point) => point.value));
  const duration = Math.max(1, durationMs);
  return points.map((point) => {
    const x = layout.left + (point.elapsedMs / duration) * (width - layout.left - layout.right);
    const y = layout.top + (1 - point.value / maximum) * (height - layout.top - layout.bottom);
    return `${x},${y}`;
  }).join(" ");
}

export function TimelineChart({
  points,
  durationMs,
  label,
  className = "chart",
  width = 760,
  height = 280,
  layout = { left: 52, top: 18, right: 18, bottom: 34 },
  bottomLabelOffset = 8,
}: TimelineChartProps) {
  const maximum = Math.max(1, ...points.map((point) => point.value));
  const coordinates = timelineCoordinates(points, durationMs, width, height, layout);
  return (
    <svg class={className} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label} over time chart`}>
      <line class="chart-axis chart-grid" x1={layout.left} x2={width - layout.right} y1={height - layout.bottom} y2={height - layout.bottom} />
      <polyline class="chart-line" points={coordinates} />
      <text class="chart-label" x="0" y={layout.top + 4}>{formatCompact(maximum)}</text>
      <text class="chart-label" x={layout.left} y={height - bottomLabelOffset}>0:00</text>
      <text class="chart-label" text-anchor="end" x={width - layout.right} y={height - bottomLabelOffset}>{formatDuration(durationMs)}</text>
    </svg>
  );
}
