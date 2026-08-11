import { Fragment, render } from "preact";
import { useCallback, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { Electroview } from "electrobun/view";
import { TitleBar } from "@svoverlay/ui-kit/title-bar";
import { SettingsButton } from "@svoverlay/ui-kit/settings-button";
import { StatusDot } from "@svoverlay/ui-kit/status-dot";
import type { StatusTone } from "@svoverlay/ui-kit/status-dot";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";
import { InteractiveChart } from "@svoverlay/ui-kit/interactive-chart";
import type { ChartRenderResult } from "@svoverlay/ui-kit/interactive-chart";
import {
  bigintRatio,
  buildCumulativeTrend,
  buildRateTrend,
  trendExtent,
} from "@kar-mi/spirit-vale-tools-rewards";
import type { TrendMetric, TrendMode, TrendRange, TrendSample } from "@kar-mi/spirit-vale-tools-rewards";
import type { RateSnapshot } from "@kar-mi/spirit-vale-tools-metrics";

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
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = repairRendererPayload(next); } } },
});
const electroview = new Electroview({ rpc });

void electroview.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });

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

function killsLabel(mob: { kills: number; attributedKills: number }): string {
  return format.format(mob.kills);
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
          <>
          <SettingsButton onClick={() => void electroview.rpc?.request.openSettings({})} />
          <button
            class={next.pinned ? "icon-button active" : "icon-button"}
            type="button"
            aria-label="Toggle always on top"
            title="Always on top"
            onClick={() => void electroview.rpc?.request.setPinned({ pinned: !next.pinned })}
          >
            {next.pinned ? "◆" : "◇"}
          </button>
          </>
        }
      />
      <main>
        <nav class="toolbar">
          <div class="seg" aria-label="Session view">
            <button class={next.view === "summary" ? "active" : undefined} type="button" onClick={() => setView("summary")}>Summary</button>
            <button class={next.view === "recent" ? "active" : undefined} type="button" onClick={() => setView("recent")}>Recent kills</button>
            <button class={next.view === "trends" ? "active" : undefined} type="button" onClick={() => setView("trends")}>Trends</button>
            <button class={next.view === "xpTracker" ? "active" : undefined} type="button" onClick={() => setView("xpTracker")}>Session Tracker</button>
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
            <thead><tr><th>Character XP</th><th>XP to Lvl Up</th><th>Job XP</th><th>Coins</th><th>Unmatched</th></tr></thead>
            <tbody><tr><td>{format.format(next.totalExperience)}</td><td>{next.xpToLevelUp === undefined ? "—" : format.format(next.xpToLevelUp)}</td><td>{format.format(next.totalJobExperience)}</td><td class="is-value">{formatDecimal(next.totalCoins)}</td><td>{format.format(next.unmatched)}</td></tr></tbody>
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
                      values={[format.format(mob.level), killsLabel(mob), format.format(mob.experience), format.format(mob.jobExperience), formatDecimal(mob.coins)]}
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
          <div class="section-head"><h1>Recent kills</h1><p>Newest first. Rewards show only where they could be attributed to one kill.</p></div>
          {next.kills.length === 0 ? (
              <div class="empty-state">{next.mode === "replay" ? "No kills in this replay." : "Waiting for a mob kill."}</div>
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

        <section hidden={next.view !== "xpTracker"}>
          <div class="section-head">
            <h1>Character XP tracker</h1>
            <p>Cumulative Character XP across sessions, until reset.</p>
          </div>
          <XpTrackerSection xp={next.xp} gold={next.gold} />
        </section>
      </main>
    </>
  );
}

function XpTrackerSection({ xp, gold }: { xp: RewardsAppState["xp"]; gold: RewardsAppState["gold"] }) {
  const samples = bucketsToTrendSamples(xp.timeline);
  const computeRender = useCallback((range: TrendRange, width: number): ChartRenderResult => {
    const rates = buildRateTrend(samples, "experience", range, width);
    const maximum = rates.reduce((highest, point) => Math.max(highest, point.value), 0);
    return {
      points: rates.map((point) => ({
        time: point.time,
        ratio: maximum > 0 ? point.value / maximum : 0,
        primary: `${formatRate(point.value)}/sec`,
        secondary: `${format.format(point.gain)} XP in ${formatTrendDuration(point.seconds)}`,
      })),
      yLabels: axisTicks(5).map((tick) => formatRate((maximum * tick) / 4)),
    };
  }, [samples]);

  return (
    <>
      <div class="table-scroll totals">
        <table class="data-table summary-table rewards-total-table" aria-label="All-time XP totals">
          <thead><tr><th>Total XP</th><th>XP / sec</th><th>XP / hr</th></tr></thead>
          <tbody>
            <tr>
              <td>{format.format(xp.total)}</td>
              <td>{format.format(xp.perSecond)}</td>
              <td>{format.format(xp.perHour)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="table-scroll totals">
        <table class="data-table summary-table rewards-total-table" aria-label="All-time gold totals">
          <thead><tr><th>Total gold</th><th>Gold / sec</th><th>Gold / hr</th></tr></thead>
          <tbody>
            <tr>
              <td>{format.format(gold.total)}</td>
              <td>{format.format(gold.perSecond)}</td>
              <td>{format.format(gold.perHour)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="xp-tracker-actions">
        <button class="btn" type="button" onClick={() => void electroview.rpc?.request.resetXpTracker({})}>Reset all-time XP</button>
        <button class="btn" type="button" onClick={() => void electroview.rpc?.request.resetGoldTracker({})}>Reset all-time gold</button>
      </div>
      <InteractiveChart
        extent={trendExtent(samples)}
        computeRender={computeRender}
        stepped={false}
        emptyLabel="XP gained will appear here as a graph once there's enough recent activity."
        ariaLabel="Character XP rate over time"
        resetKey="xp-tracker"
      />
    </>
  );
}

/** The tracker's neutral buckets, re-keyed onto the `experience` field `buildRateTrend` reads. */
function bucketsToTrendSamples(buckets: RateSnapshot["timeline"]): TrendSample[] {
  return buckets.map((bucket) => ({
    recordedAt: new Date(bucket.atMs).toISOString(),
    experience: bucket.value,
    jobExperience: 0,
    coins: "0",
  }));
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

interface TrendChartProps {
  samples: readonly TrendSample[];
  replay: boolean;
  sessionKey: string;
}

function TrendChart({ samples, replay, sessionKey }: TrendChartProps) {
  const [metric, setMetric] = useState<TrendMetric>("experience");
  const [mode, setMode] = useState<TrendMode>("rate");

  const computeRender = useCallback((range: TrendRange, width: number): ChartRenderResult => {
    if (mode === "cumulative") {
      const cumulative = buildCumulativeTrend(samples, metric, range);
      const maximum = cumulative.reduce((highest, point) => (point.value > highest ? point.value : highest), 0n);
      return {
        points: cumulative.map((point) => ({
          time: point.time,
          ratio: bigintRatio(point.value, maximum),
          primary: formatDecimal(point.value.toString()),
          secondary: `${metricLabel(metric)} total`,
        })),
        yLabels: axisTicks(5).map((tick) => formatDecimal((maximum * BigInt(tick) / 4n).toString())),
      };
    }
    const rates = buildRateTrend(samples, metric, range, width);
    const maximum = rates.reduce((highest, point) => Math.max(highest, point.value), 0);
    return {
      points: rates.map((point) => ({
        time: point.time,
        ratio: maximum > 0 ? point.value / maximum : 0,
        primary: `${formatRate(point.value)}/sec`,
        secondary: `${formatDecimal(point.gain.toString())} in ${formatTrendDuration(point.seconds)}`,
      })),
      yLabels: axisTicks(5).map((tick) => formatRate((maximum * tick) / 4)),
    };
  }, [samples, metric, mode]);

  const chartTitle = `${metricLabel(metric)} ${mode === "rate" ? "rate per second" : "cumulative total"} over time`;
  const emptyLabel = replay ? "No timestamped rewards in this replay." : "Confirmed rewards will appear here.";

  return (
    <>
      <div class="trend-controls">
        <div class="seg" aria-label="Trend metric">
          <button class={metric === "experience" ? "active" : undefined} type="button" onClick={() => setMetric("experience")}>Character XP</button>
          <button class={metric === "jobExperience" ? "active" : undefined} type="button" onClick={() => setMetric("jobExperience")}>Job XP</button>
          <button class={metric === "coins" ? "active" : undefined} type="button" onClick={() => setMetric("coins")}>Coins</button>
        </div>
        <div class="seg" aria-label="Trend calculation">
          <button class={mode === "rate" ? "active" : undefined} type="button" onClick={() => setMode("rate")}>Rate/sec</button>
          <button class={mode === "cumulative" ? "active" : undefined} type="button" onClick={() => setMode("cumulative")}>Cumulative</button>
        </div>
      </div>
      <InteractiveChart
        extent={trendExtent(samples)}
        computeRender={computeRender}
        stepped={mode === "cumulative"}
        emptyLabel={emptyLabel}
        ariaLabel={chartTitle}
        resetKey={`${sessionKey}:${metric}:${mode}`}
      />
    </>
  );
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

function axisTicks(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

render(<App />, document.getElementById("root")!);
