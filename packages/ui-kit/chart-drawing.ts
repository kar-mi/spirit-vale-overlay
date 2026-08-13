import type { ChartPoint, ChartRange } from "./interactive-chart.tsx";

interface ChartPlot {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function drawAxes(
  svg: SVGSVGElement,
  range: ChartRange,
  plot: ChartPlot,
  yLabels: readonly string[],
  xAxisTickCount: number,
  formatAxisTime: (value: number, range: ChartRange) => string,
): void {
  for (const tick of axisTicks(5)) {
    const y = plot.top + plot.height - (tick / 4) * plot.height;
    svg.append(svgElement("line", "trend-grid", { x1: plot.left, y1: y, x2: plot.left + plot.width, y2: y }));
    const label = svgElement("text", "trend-axis-label", { x: plot.left - 10, y: y + 4, "text-anchor": "end" });
    label.textContent = yLabels[tick] ?? "0";
    svg.append(label);
  }
  const xTicks = axisTicks(Math.max(2, xAxisTickCount));
  for (const tick of xTicks) {
    const ratio = tick / (xTicks.length - 1);
    const x = plot.left + ratio * plot.width;
    const label = svgElement("text", "trend-axis-label", {
      x,
      y: plot.top + plot.height + 25,
      "text-anchor": tick === 0 ? "start" : tick === xTicks.length - 1 ? "end" : "middle",
    });
    label.textContent = formatAxisTime(range.start + ratio * (range.end - range.start), range);
    svg.append(label);
  }
}

export function drawLine(
  svg: SVGSVGElement,
  points: readonly ChartPoint[],
  range: ChartRange,
  plot: ChartPlot,
  stepped: boolean,
): void {
  if (!points.length) return;
  const coordinates = points.map((point) => ({
    x: plot.left + ((point.time - range.start) / Math.max(1, range.end - range.start)) * plot.width,
    y: plot.top + plot.height - point.ratio * plot.height,
  }));
  const first = coordinates[0];
  if (!first) return;
  let path = `M ${first.x} ${first.y}`;
  for (let index = 1; index < coordinates.length; index += 1) {
    const point = coordinates[index];
    if (!point) continue;
    path += stepped ? ` H ${point.x} V ${point.y}` : ` L ${point.x} ${point.y}`;
  }
  svg.append(svgElement("path", "trend-line", { d: path }));
}

export function normalizedRange(range: ChartRange, extent: ChartRange): ChartRange {
  const start = Math.max(extent.start, Math.min(range.start, extent.end));
  const end = Math.min(range.end, extent.end);
  return end > start ? { start, end } : extent;
}

export function defaultFormatAxisTime(value: number, range: ChartRange): string {
  const longRange = range.end - range.start >= 86_400_000;
  return new Intl.DateTimeFormat(undefined, longRange
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(value);
}

function axisTicks(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

export function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  className: string,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  node.setAttribute("class", className);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

export function svgText<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, value: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}
