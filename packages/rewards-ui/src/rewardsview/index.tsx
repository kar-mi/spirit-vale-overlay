import { Fragment, render } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { Electroview } from "electrobun/view";
import { TitleBar } from "@spiritvale/ui-core/title-bar";
import { StatusDot } from "@spiritvale/ui-core/status-dot";
import type { StatusTone } from "@spiritvale/ui-core/status-dot";
import {
  bigintRatio,
  buildCumulativeTrend,
  buildRateTrend,
  trendExtent,
} from "@kar-mi/spirit-vale-tools-rewards";
import type { TrendMetric, TrendMode, TrendRange, TrendSample } from "@kar-mi/spirit-vale-tools-rewards";

import type { RewardsAppRpc, RewardsAppState, RewardsAppView, RewardsUiDrop } from "../app-types.ts";
import { sortRewardKills, sortRewardSummaries } from "../table-sort.ts";
import type { KillSortKey, SortDirection, SummarySortKey, TableSort } from "../table-sort.ts";

const STATUS_TONE: Record<RewardsAppState["status"], StatusTone> = {
  waiting: "is-warn",
  watching: "is-ok",
  ready: "is-ok",
  stopped: "is-warn",
  error: "is-err",
};

const format = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const timestampFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" });

const state = signal<RewardsAppState | undefined>(undefined);

const rpc = Electroview.defineRPC<RewardsAppRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = next; } } },
});
const electroview = new Electroview({ rpc });

void electroview.rpc?.request.getState({}).then((next) => { state.value = next; });

function setView(view: RewardsAppView): void {
  void electroview.rpc?.request.setView({ view });
}

function returnToLive(): void {
  void electroview.rpc?.request.setMode({ mode: "live" });
}

function formatDecimal(value: string): string {
  try {
    return format.format(BigInt(value));
  } catch {
    return value;
  }
}

function formatChance(value: number): string {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value)}%`;
}

function formatDrop(drop: RewardsUiDrop): string {
  return `${drop.itemName} ×${drop.count}${drop.chance === undefined ? "" : ` · ${formatChance(drop.chance)}`}`;
}

function formatTimestamp(value: string | undefined): string {
  if (value === undefined) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : timestampFormat.format(parsed);
}

function App() {
  const next = state.value;
  const [summarySort, setSummarySort] = useState<TableSort<SummarySortKey>>({ key: "kills", direction: "descending" });
  const [killSort, setKillSort] = useState<TableSort<KillSortKey>>({ key: "timestamp", direction: "descending" });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  if (!next) return null;

  const sessionKey = `${next.mode}:${next.replayFileName ?? "live"}`;
  const summaries = sortRewardSummaries(next.summaries, summarySort);
  const kills = sortRewardKills(next.kills, killSort);
  const toggleExpanded = (key: string): void => {
    setExpanded((current) => {
      const updated = new Set(current);
      if (updated.has(key)) updated.delete(key); else updated.add(key);
      return updated;
    });
  };

  return (
    <>
      <TitleBar
        appTag="Rewards"
        minWidth={620}
        minHeight={520}
        getFrame={async () => (await electroview.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: 620, height: 520 }}
        setFrame={(frame) => void electroview.rpc?.request.setWindowFrame(frame)}
        toggleMaximize={async () => (await electroview.rpc?.request.toggleMaximize({}))?.maximized ?? false}
        onMinimize={() => void electroview.rpc?.request.windowAction({ action: "minimize" })}
        onClose={() => void electroview.rpc?.request.windowAction({ action: "close" })}
        extraControls={
          <button
            class={next.pinned ? "icon-button active" : "icon-button"}
            type="button"
            aria-label="Toggle always on top"
            title="Always on top"
            onClick={() => void electroview.rpc?.request.setPinned({ pinned: !next.pinned })}
          >
            {next.pinned ? "◆" : "◇"}
          </button>
        }
      />
      <main>
        <nav class="toolbar">
          <div class="seg" aria-label="Session view">
            <button class={next.view === "summary" ? "active" : undefined} type="button" onClick={() => setView("summary")}>Summary</button>
            <button class={next.view === "recent" ? "active" : undefined} type="button" onClick={() => setView("recent")}>Recent kills</button>
            <button class={next.view === "trends" ? "active" : undefined} type="button" onClick={() => setView("trends")}>Trends</button>
          </div>
          <StatusDot tone={STATUS_TONE[next.status]} detail={next.statusDetail} />
          <div class="toolbar-actions">
            <button class="btn" type="button" onClick={() => void electroview.rpc?.request.openCatalog({})}>Catalog</button>
            <button class={next.mode === "replay" ? "btn active" : "btn"} type="button" onClick={() => void electroview.rpc?.request.openReplayPicker({})}>Replay</button>
            <button class="btn" type="button" disabled={next.mode === "replay" || next.resetting} onClick={() => void electroview.rpc?.request.resetSession({})}>Reset</button>
          </div>
        </nav>

        {next.mode === "replay" && (
          <div class="banner is-info">
            <span>
              Viewing replay: {next.replayFileName ?? "selected log"}
              {next.replayWarnings > 0 ? ` · ${next.replayWarnings} malformed records skipped` : ""}
            </span>
            <button class="btn" type="button" onClick={returnToLive}>Return to live</button>
          </div>
        )}

        {next.storageWarning !== undefined && <div class="banner is-warn" aria-live="polite">{next.storageWarning}</div>}

        <div class="table-scroll totals">
          <table class="data-table summary-table rewards-total-table" aria-label="Reward totals">
            <thead><tr><th>Character XP</th><th>Job XP</th><th>Coins</th><th>Unmatched</th></tr></thead>
            <tbody><tr><td>{format.format(next.totalExperience)}</td><td>{format.format(next.totalJobExperience)}</td><td class="is-value">{formatDecimal(next.totalCoins)}</td><td>{format.format(next.unmatched)}</td></tr></tbody>
          </table>
        </div>

        {next.unidentified > 0 && (
          <div class="banner is-warn">
            {`${format.format(next.unidentified)} reward ${next.unidentified === 1 ? "event came" : "events came"} from mobs whose spawn happened before capture. Change maps or wait for those mobs to respawn; newly observed mobs will be categorized.`}
          </div>
        )}

        <section hidden={next.view !== "summary"}>
          <div class="section-head"><h1>Mob summary</h1><p>Confirmed rewards grouped by mob, plus unmatched pickups.</p></div>
          {next.summaries.length === 0 && next.unmatchedDrops.length === 0 ? (
              <div class="empty-state">{next.mode === "replay" ? "No confirmed mob totals in this replay." : "Confirmed mob totals will appear here."}</div>
            ) : (
              <div class="table-scroll rewards-table-scroll">
                <table class="data-table rewards-table" aria-label="Mob reward summary">
                  <thead><tr>
                    <RewardSortHeader label="Mob" active={summarySort.key === "displayName"} direction={summarySort.direction} onSort={() => setSummarySort(nextSort(summarySort, "displayName"))} />
                    <RewardSortHeader label="Level" active={summarySort.key === "level"} direction={summarySort.direction} onSort={() => setSummarySort(nextSort(summarySort, "level"))} />
                    <RewardSortHeader label="Kills" active={summarySort.key === "kills"} direction={summarySort.direction} onSort={() => setSummarySort(nextSort(summarySort, "kills"))} />
                    <RewardSortHeader label="Char XP" active={summarySort.key === "experience"} direction={summarySort.direction} onSort={() => setSummarySort(nextSort(summarySort, "experience"))} />
                    <RewardSortHeader label="Job XP" active={summarySort.key === "jobExperience"} direction={summarySort.direction} onSort={() => setSummarySort(nextSort(summarySort, "jobExperience"))} />
                    <RewardSortHeader label="Coins" active={summarySort.key === "coins"} direction={summarySort.direction} onSort={() => setSummarySort(nextSort(summarySort, "coins"))} />
                    <th>Drops</th>
                  </tr></thead>
                  <tbody>
                    {summaries.map((mob) => <RewardRow
                      key={mob.mobId}
                      rowKey={`summary-${mob.mobId}`}
                      name={mob.displayName}
                      values={[format.format(mob.level), format.format(mob.kills), format.format(mob.experience), format.format(mob.jobExperience), formatDecimal(mob.coins)]}
                      drops={mob.drops}
                      expanded={expanded}
                      onToggle={toggleExpanded}
                    />)}
                    {next.unmatchedDrops.length > 0 && <RewardRow rowKey="summary-unmatched" name="Unmatched" values={["—", "—", "—", "—", "—"]} drops={next.unmatchedDrops} expanded={expanded} onToggle={toggleExpanded} />}
                  </tbody>
                </table>
              </div>
            )}
        </section>

        <section hidden={next.view !== "recent"}>
          <div class="section-head"><h1>Recent kills</h1><p>Newest confirmed attribution first.</p></div>
          {next.kills.length === 0 ? (
              <div class="empty-state">{next.mode === "replay" ? "No confirmed kills in this replay." : "Waiting for a confirmed mob reward."}</div>
            ) : (
              <div class="table-scroll rewards-table-scroll">
                <table class="data-table rewards-table recent-rewards-table" aria-label="Recent kills">
                  <thead><tr>
                    <RewardSortHeader label="Mob" active={killSort.key === "displayName"} direction={killSort.direction} onSort={() => setKillSort(nextSort(killSort, "displayName"))} />
                    <RewardSortHeader label="Level" active={killSort.key === "level"} direction={killSort.direction} onSort={() => setKillSort(nextSort(killSort, "level"))} />
                    <RewardSortHeader label="Char XP" active={killSort.key === "experience"} direction={killSort.direction} onSort={() => setKillSort(nextSort(killSort, "experience"))} />
                    <RewardSortHeader label="Job XP" active={killSort.key === "jobExperience"} direction={killSort.direction} onSort={() => setKillSort(nextSort(killSort, "jobExperience"))} />
                    <RewardSortHeader label="Coins" active={killSort.key === "coins"} direction={killSort.direction} onSort={() => setKillSort(nextSort(killSort, "coins"))} />
                    <th>Drops</th>
                    <RewardSortHeader label="Timestamp" active={killSort.key === "timestamp"} direction={killSort.direction} onSort={() => setKillSort(nextSort(killSort, "timestamp"))} />
                  </tr></thead>
                  <tbody>{kills.map((kill) => <RewardRow
                    key={kill.id}
                    rowKey={`kill-${kill.id}`}
                    name={kill.displayName}
                    values={[format.format(kill.level), `+${format.format(kill.experience)}`, `+${format.format(kill.jobExperience)}`, `+${formatDecimal(kill.coins)}`]}
                    drops={kill.drops}
                    trailingValues={[formatTimestamp(kill.timestamp)]}
                    expanded={expanded}
                    onToggle={toggleExpanded}
                  />)}</tbody>
                </table>
              </div>
            )}
        </section>

        <section hidden={next.view !== "trends"}>
          <div class="section-head"><h1>Reward trends</h1><p>Session gains over wall-clock time.</p></div>
          <TrendChart samples={next.graphSamples} replay={next.mode === "replay"} sessionKey={sessionKey} />
        </section>
      </main>
    </>
  );
}

function RewardRow({ rowKey, name, values, drops, trailingValues = [], expanded, onToggle }: { rowKey: string; name: string; values: readonly string[]; drops: readonly RewardsUiDrop[]; trailingValues?: readonly string[]; expanded: ReadonlySet<string>; onToggle(key: string): void }) {
  const isExpanded = expanded.has(rowKey);
  const detailId = `reward-drops-${safeDomId(rowKey)}`;
  return <Fragment>
    <tr>
      <th scope="row" title={name}>{name}</th>
      {values.map((value, index) => <td key={index}>{value}</td>)}
      <td>{drops.length === 0 ? "—" : <button class="table-detail-button" type="button" aria-expanded={isExpanded} aria-controls={detailId} onClick={() => onToggle(rowKey)}>{isExpanded ? "▾" : "▸"} {drops.length}</button>}</td>
      {trailingValues.map((value, index) => <td key={`trailing-${index}`} title={value}>{value}</td>)}
    </tr>
    {isExpanded && drops.length > 0 && <tr id={detailId} class="table-detail-row"><td colSpan={values.length + trailingValues.length + 2}><div class="table-detail-chips">{drops.map((drop, index) => <span class="chip" key={`${drop.itemId}-${index}`}>{formatDrop(drop)}</span>)}</div></td></tr>}
  </Fragment>;
}

function RewardSortHeader({ label, active, direction, onSort }: { label: string; active: boolean; direction: SortDirection; onSort(): void }) {
  return <th class="sortable-column" aria-sort={active ? direction : undefined}><button class="sort-button" type="button" onClick={onSort}><span>{label}</span><span class={active ? "sort-indicator active" : "sort-indicator"} aria-hidden="true">{active ? (direction === "descending" ? "▼" : "▲") : "↕"}</span></button></th>;
}

function nextSort<K extends string>(current: TableSort<K>, key: K): TableSort<K> {
  return { key, direction: current.key === key && current.direction === "descending" ? "ascending" : "descending" };
}

function safeDomId(value: string): string { return value.replace(/[^a-zA-Z0-9_-]/g, "-"); }

// ---- trend chart ----
// Kept imperative (direct SVG/DOM manipulation behind refs) rather than
// declarative JSX: this is tightly-coupled, per-frame drawing plus
// drag-to-zoom / hover / keyboard-nav interaction, and rewriting it
// declaratively would risk regressions for no real benefit.

interface TrendDisplayPoint {
  time: number;
  ratio: number;
  primary: string;
  secondary: string;
}

interface RenderedTrend {
  range: TrendRange;
  left: number;
  top: number;
  width: number;
  height: number;
  points: TrendDisplayPoint[];
}

interface TrendChartProps {
  samples: readonly TrendSample[];
  replay: boolean;
  sessionKey: string;
}

function TrendChart({ samples, replay, sessionKey }: TrendChartProps) {
  const [metric, setMetric] = useState<TrendMetric>("experience");
  const [mode, setMode] = useState<TrendMode>("rate");
  const [zoom, setZoom] = useState<TrendRange | undefined>(undefined);

  const chartRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef<RenderedTrend | undefined>(undefined);
  const dragStartRef = useRef<number | undefined>(undefined);
  const keyboardPointRef = useRef(-1);
  const sessionKeyRef = useRef(sessionKey);

  useEffect(() => {
    if (sessionKeyRef.current !== sessionKey) {
      sessionKeyRef.current = sessionKey;
      setZoom(undefined);
    }
  }, [sessionKey]);

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
    const extent = trendExtent(samples);
    if (!extent || chart.clientWidth === 0 || chart.clientHeight === 0) {
      empty.hidden = false;
      empty.textContent = replay ? "No timestamped rewards in this replay." : "Confirmed rewards will appear here.";
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
    const range = normalizedTrendRange(zoom ?? extent, extent);
    svg.setAttribute("viewBox", `0 0 ${chartWidth} ${chartHeight}`);

    let points: TrendDisplayPoint[];
    let yLabels: string[];
    if (mode === "cumulative") {
      const cumulative = buildCumulativeTrend(samples, metric, range);
      const maximum = cumulative.reduce((highest, point) => (point.value > highest ? point.value : highest), 0n);
      points = cumulative.map((point) => ({
        time: point.time,
        ratio: bigintRatio(point.value, maximum),
        primary: formatDecimal(point.value.toString()),
        secondary: `${metricLabel(metric)} total`,
      }));
      yLabels = axisTicks(5).map((tick) => formatDecimal((maximum * BigInt(tick) / 4n).toString()));
    } else {
      const rates = buildRateTrend(samples, metric, range, width);
      const maximum = rates.reduce((highest, point) => Math.max(highest, point.value), 0);
      points = rates.map((point) => ({
        time: point.time,
        ratio: maximum > 0 ? point.value / maximum : 0,
        primary: `${formatRate(point.value)}/sec`,
        secondary: `${formatDecimal(point.gain.toString())} in ${formatTrendDuration(point.seconds)}`,
      }));
      yLabels = axisTicks(5).map((tick) => formatRate((maximum * tick) / 4));
    }

    drawTrendAxes(svg, range, { left, top, width, height }, yLabels);
    drawTrendLine(svg, points, range, { left, top, width, height }, mode === "cumulative");
    renderedRef.current = { range, left, top, width, height, points };
  }, [samples, metric, mode, zoom, replay, hideTooltip]);

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

  function timeAt(x: number, chart: RenderedTrend): number {
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

  const chartTitle = `${metricLabel(metric)} ${mode === "rate" ? "rate per second" : "cumulative total"} over time`;

  return (
    <>
      <div class="trend-controls">
        <div class="seg" aria-label="Trend metric">
          <button class={metric === "experience" ? "active" : undefined} type="button" onClick={() => { setMetric("experience"); setZoom(undefined); }}>Character XP</button>
          <button class={metric === "jobExperience" ? "active" : undefined} type="button" onClick={() => { setMetric("jobExperience"); setZoom(undefined); }}>Job XP</button>
          <button class={metric === "coins" ? "active" : undefined} type="button" onClick={() => { setMetric("coins"); setZoom(undefined); }}>Coins</button>
        </div>
        <div class="seg" aria-label="Trend calculation">
          <button class={mode === "rate" ? "active" : undefined} type="button" onClick={() => { setMode("rate"); setZoom(undefined); }}>Rate/sec</button>
          <button class={mode === "cumulative" ? "active" : undefined} type="button" onClick={() => { setMode("cumulative"); setZoom(undefined); }}>Cumulative</button>
        </div>
        <button class="btn" type="button" hidden={zoom === undefined} onClick={() => setZoom(undefined)}>Reset zoom</button>
      </div>
      <div
        ref={chartRef}
        class="trend-chart"
        tabIndex={0}
        aria-label="Rewards trend graph"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => { if (dragStartRef.current === undefined) hideTooltip(); }}
        onKeyDown={onKeyDown}
      >
        <svg ref={svgRef} role="img" aria-labelledby="trend-chart-title" />
        <span id="trend-chart-title" class="sr-only">{chartTitle}</span>
        <div ref={emptyRef} class="trend-empty" />
        <div ref={tooltipRef} class="trend-tooltip" hidden />
      </div>
    </>
  );
}

function drawTrendAxes(
  svg: SVGSVGElement,
  range: TrendRange,
  plot: Pick<RenderedTrend, "left" | "top" | "width" | "height">,
  yLabels: readonly string[],
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

function drawTrendLine(
  svg: SVGSVGElement,
  points: readonly TrendDisplayPoint[],
  range: TrendRange,
  plot: Pick<RenderedTrend, "left" | "top" | "width" | "height">,
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

function normalizedTrendRange(range: TrendRange, extent: TrendRange): TrendRange {
  const start = Math.max(extent.start, Math.min(range.start, extent.end));
  const end = Math.min(range.end, extent.end);
  return end > start ? { start, end } : extent;
}

function metricLabel(metric: TrendMetric): string {
  if (metric === "experience") return "Character XP";
  if (metric === "jobExperience") return "Job XP";
  return "Coins";
}

function formatRate(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: value < 10 ? 2 : 1 }).format(value);
}

function formatTrendDuration(seconds: number): string {
  return seconds >= 60
    ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(seconds / 60)} min`
    : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(seconds)} sec`;
}

function formatAxisTime(value: number, range: TrendRange): string {
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

render(<App />, document.getElementById("root")!);
