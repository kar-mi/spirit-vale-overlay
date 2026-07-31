import { useCallback, useEffect, useRef, useState } from "preact/hooks";

// Kept imperative (direct SVG/DOM manipulation behind refs) rather than
// declarative JSX: this is tightly-coupled, per-frame drawing plus
// drag-to-zoom / hover / keyboard-nav interaction, and rewriting it
// declaratively would risk regressions for no real benefit.

export interface ChartRange {
  start: number;
  end: number;
}

export interface ChartPoint {
  time: number;
  ratio: number;
  primary: string;
  secondary: string;
}

export interface ChartRenderResult {
  points: ChartPoint[];
  yLabels: string[];
}

interface RenderedChart {
  range: ChartRange;
  left: number;
  top: number;
  width: number;
  height: number;
  points: ChartPoint[];
}

export interface InteractiveChartProps {
  /** The full range of available data, used to frame the initial view and clamp zoom. `undefined` shows the empty state. */
  extent: ChartRange | undefined;
  /** Called whenever the chart needs to redraw (mount, resize, zoom change, or `extent`/other identity changes) for the currently visible range and plot width in pixels. */
  computeRender: (range: ChartRange, plotWidthPx: number) => ChartRenderResult;
  /** Cumulative-style (step) line vs a smooth rate line. */
  stepped: boolean;
  emptyLabel: string;
  ariaLabel: string;
  /** Resets any active zoom when this value changes (e.g. a new session, or a tracker reset). */
  resetKey: string;
  formatAxisTime?: (value: number, range: ChartRange) => string;
}

export function InteractiveChart(
  { extent, computeRender, stepped, emptyLabel, ariaLabel, resetKey, formatAxisTime = defaultFormatAxisTime }: InteractiveChartProps,
) {
  const [zoom, setZoom] = useState<ChartRange | undefined>(undefined);

  const chartRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef<RenderedChart | undefined>(undefined);
  const dragStartRef = useRef<number | undefined>(undefined);
  const keyboardPointRef = useRef(-1);
  const resetKeyRef = useRef(resetKey);

  useEffect(() => {
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      setZoom(undefined);
    }
  }, [resetKey]);

  const hideTooltip = useCallback((): void => {
    for (const node of svgRef.current?.querySelectorAll(".trend-hover") ?? []) node.remove();
    if (tooltipRef.current) tooltipRef.current.hidden = true;
  }, []);

  const draw = useCallback((): void => {
    const svg = svgRef.current;
    const chart = chartRef.current;
    const empty = emptyRef.current;
    if (!svg || !chart || !empty) return;
    hideTooltip();
    keyboardPointRef.current = -1;

    svg.replaceChildren();
    if (!extent || chart.clientWidth === 0 || chart.clientHeight === 0) {
      empty.hidden = false;
      empty.textContent = emptyLabel;
      renderedRef.current = undefined;
      return;
    }
    empty.hidden = true;

    const chartWidth = chart.clientWidth;
    const chartHeight = chart.clientHeight;
    const left = 70;
    const top = 20;
    const right = 20;
    const bottom = 42;
    const width = Math.max(1, chartWidth - left - right);
    const height = Math.max(1, chartHeight - top - bottom);
    const range = normalizedRange(zoom ?? extent, extent);
    svg.setAttribute("viewBox", `0 0 ${chartWidth} ${chartHeight}`);

    const { points, yLabels } = computeRender(range, width);

    drawAxes(svg, range, { left, top, width, height }, yLabels, formatAxisTime);
    drawLine(svg, points, range, { left, top, width, height }, stepped);
    renderedRef.current = { range, left, top, width, height, points };
  }, [extent, computeRender, stepped, emptyLabel, formatAxisTime, zoom, hideTooltip]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(chart);
    return () => observer.disconnect();
  }, [draw]);

  function localX(clientX: number): number {
    const bounds = chartRef.current!.getBoundingClientRect();
    return clientX - bounds.left;
  }

  function timeAt(x: number, chart: RenderedChart): number {
    const ratio = Math.max(0, Math.min(1, (x - chart.left) / chart.width));
    return chart.range.start + ratio * (chart.range.end - chart.range.start);
  }

  function showPoint(index: number): void {
    const chart = renderedRef.current;
    const point = chart?.points[index];
    if (!chart || !point) return;
    hideTooltip();
    const x = chart.left + ((point.time - chart.range.start) / Math.max(1, chart.range.end - chart.range.start)) * chart.width;
    const y = chart.top + chart.height - point.ratio * chart.height;
    const svg = svgRef.current!;
    svg.append(
      svgElement("line", "trend-crosshair trend-hover", { x1: x, y1: chart.top, x2: x, y2: chart.top + chart.height }),
      svgElement("circle", "trend-marker trend-hover", { cx: x, cy: y, r: 4 }),
    );
    const tooltip = tooltipRef.current!;
    tooltip.replaceChildren(
      svgText("strong", "", point.primary),
      svgText("div", "", point.secondary),
      svgText("div", "", new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(point.time)),
    );
    tooltip.hidden = false;
    const tooltipWidth = 180;
    const chartEl = chartRef.current!;
    tooltip.style.left = `${Math.min(chartEl.clientWidth - tooltipWidth - 8, Math.max(8, x + 10))}px`;
    tooltip.style.top = `${Math.max(8, y - 30)}px`;
  }

  function showHover(x: number): void {
    const rendered = renderedRef.current;
    if (!rendered?.points.length) return;
    const time = timeAt(x, rendered);
    let closest = 0;
    for (let index = 1; index < rendered.points.length; index += 1) {
      const candidate = rendered.points[index];
      const current = rendered.points[closest];
      if (candidate && current && Math.abs(candidate.time - time) < Math.abs(current.time - time)) closest = index;
    }
    showPoint(closest);
  }

  function removeSelection(): void {
    svgRef.current?.querySelector(".trend-selection")?.remove();
  }

  function updateSelection(start: number, end: number): void {
    const chart = renderedRef.current;
    if (!chart) return;
    removeSelection();
    const left = Math.max(chart.left, Math.min(start, end));
    const right = Math.min(chart.left + chart.width, Math.max(start, end));
    svgRef.current!.append(svgElement("rect", "trend-selection", { x: left, y: chart.top, width: Math.max(0, right - left), height: chart.height }));
  }

  function onPointerDown(event: PointerEvent): void {
    if (!renderedRef.current || event.button !== 0) return;
    dragStartRef.current = localX(event.clientX);
    chartRef.current!.setPointerCapture(event.pointerId);
    updateSelection(dragStartRef.current, dragStartRef.current);
  }

  function onPointerMove(event: PointerEvent): void {
    const x = localX(event.clientX);
    if (dragStartRef.current !== undefined) updateSelection(dragStartRef.current, x);
    else showHover(x);
  }

  function onPointerUp(event: PointerEvent): void {
    const chart = renderedRef.current;
    if (!chart || dragStartRef.current === undefined) return;
    const end = localX(event.clientX);
    const start = dragStartRef.current;
    dragStartRef.current = undefined;
    removeSelection();
    if (chartRef.current!.hasPointerCapture(event.pointerId)) chartRef.current!.releasePointerCapture(event.pointerId);
    if (Math.abs(end - start) < 10) {
      showHover(end);
      return;
    }
    const left = Math.max(chart.left, Math.min(start, end));
    const right = Math.min(chart.left + chart.width, Math.max(start, end));
    setZoom({ start: timeAt(left, chart), end: timeAt(right, chart) });
  }

  function onPointerCancel(): void {
    dragStartRef.current = undefined;
    removeSelection();
  }

  function onKeyDown(event: KeyboardEvent): void {
    const points = renderedRef.current?.points;
    if (!points?.length || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") keyboardPointRef.current = 0;
    else if (event.key === "End") keyboardPointRef.current = points.length - 1;
    else if (event.key === "ArrowLeft") keyboardPointRef.current = Math.max(0, keyboardPointRef.current < 0 ? points.length - 1 : keyboardPointRef.current - 1);
    else keyboardPointRef.current = Math.min(points.length - 1, keyboardPointRef.current + 1);
    showPoint(keyboardPointRef.current);
  }

  return (
    <div class="interactive-chart">
      <div
        ref={chartRef}
        class="trend-chart"
        tabIndex={0}
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => { if (dragStartRef.current === undefined) hideTooltip(); }}
        onKeyDown={onKeyDown}
      >
        <svg ref={svgRef} role="img" aria-label={ariaLabel} />
        <div ref={emptyRef} class="trend-empty" />
        <div ref={tooltipRef} class="trend-tooltip" hidden />
      </div>
      {zoom !== undefined && <button class="btn chart-reset-zoom" type="button" onClick={() => setZoom(undefined)}>Reset zoom</button>}
    </div>
  );
}

function drawAxes(
  svg: SVGSVGElement,
  range: ChartRange,
  plot: Pick<RenderedChart, "left" | "top" | "width" | "height">,
  yLabels: readonly string[],
  formatAxisTime: (value: number, range: ChartRange) => string,
): void {
  for (const tick of axisTicks(5)) {
    const y = plot.top + plot.height - (tick / 4) * plot.height;
    svg.append(svgElement("line", "trend-grid", { x1: plot.left, y1: y, x2: plot.left + plot.width, y2: y }));
    const label = svgElement("text", "trend-axis-label", { x: plot.left - 10, y: y + 4, "text-anchor": "end" });
    label.textContent = yLabels[tick] ?? "0";
    svg.append(label);
  }
  for (const tick of axisTicks(5)) {
    const ratio = tick / 4;
    const x = plot.left + ratio * plot.width;
    const label = svgElement("text", "trend-axis-label", { x, y: plot.top + plot.height + 25, "text-anchor": tick === 0 ? "start" : tick === 4 ? "end" : "middle" });
    label.textContent = formatAxisTime(range.start + ratio * (range.end - range.start), range);
    svg.append(label);
  }
}

function drawLine(
  svg: SVGSVGElement,
  points: readonly ChartPoint[],
  range: ChartRange,
  plot: Pick<RenderedChart, "left" | "top" | "width" | "height">,
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

function normalizedRange(range: ChartRange, extent: ChartRange): ChartRange {
  const start = Math.max(extent.start, Math.min(range.start, extent.end));
  const end = Math.min(range.end, extent.end);
  return end > start ? { start, end } : extent;
}

function defaultFormatAxisTime(value: number, range: ChartRange): string {
  const longRange = range.end - range.start >= 86_400_000;
  return new Intl.DateTimeFormat(undefined, longRange
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(value);
}

function axisTicks(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  className: string,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  node.setAttribute("class", className);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function svgText<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, value: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}
