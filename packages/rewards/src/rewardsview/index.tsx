import { Fragment, render } from "preact";
import { useCallback, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { DesktopView } from "@svoverlay/desktop-runtime/view";
import { TitleBar } from "@svoverlay/ui-kit/title-bar";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
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
import { nextTableSort, SortableHeader } from "@svoverlay/ui-kit/sortable-table";
import type { TableSort } from "@svoverlay/ui-kit/sortable-table";
import { useTranslator } from "@svoverlay/i18n/browser";
import type { Translator } from "@svoverlay/i18n/translate";
import type { MessageKey } from "@svoverlay/i18n/messages";

import type { RewardsAppRpc, RewardsAppState, RewardsAppView, RewardsUiDrop } from "../app-types.ts";
import { sortRewardKills, sortRewardSummaries } from "../table-sort.ts";
import type { KillSortKey, SummarySortKey } from "../table-sort.ts";

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

const rpc = DesktopView.defineRPC<RewardsAppRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = repairRendererPayload(next); } } },
});
const desktopView = new DesktopView({ rpc });

void desktopView.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });

const REWARDS_DEFAULT_WIDTH = 620;
const REWARDS_DEFAULT_HEIGHT = 520;
void ensureInitialWindowSize(desktopView.rpc?.request, { width: REWARDS_DEFAULT_WIDTH, height: REWARDS_DEFAULT_HEIGHT });

function setView(view: RewardsAppView): void {
  void desktopView.rpc?.request.setView({ view });
}

function returnToLive(): void {
  void desktopView.rpc?.request.setMode({ mode: "live" });
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
  const t = useTranslator();
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
  const sortSummariesBy = (key: SummarySortKey): void => {
    setSummarySort((current) => nextTableSort(current, key));
  };
  const sortKillsBy = (key: KillSortKey): void => {
    setKillSort((current) => nextTableSort(current, key));
  };

  return (
    <>
      <TitleBar
        appTag={t("rewards.window.tag")}
        minWidth={620}
        minHeight={520}
        getFrame={async () => (await desktopView.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: REWARDS_DEFAULT_WIDTH, height: REWARDS_DEFAULT_HEIGHT }}
        setFrame={(frame) => void desktopView.rpc?.request.setWindowFrame(frame)}
        toggleMaximize={async () => (await desktopView.rpc?.request.toggleMaximize({}))?.maximized ?? false}
        onMinimize={() => void desktopView.rpc?.request.windowAction({ action: "minimize" })}
        onClose={() => void desktopView.rpc?.request.windowAction({ action: "close" })}
        extraControls={
          <>
          <SettingsButton onClick={() => void desktopView.rpc?.request.openSettings({})} />
          <button
            class={next.pinned ? "icon-button active" : "icon-button"}
            type="button"
            aria-label={t("rewards.pinned.aria")}
            title={t("rewards.pinned.title")}
            onClick={() => void desktopView.rpc?.request.setPinned({ pinned: !next.pinned })}
          >
            {next.pinned ? "◆" : "◇"}
          </button>
          </>
        }
      />
      <main>
        <nav class="toolbar">
          <div class="seg" aria-label={t("rewards.view.label")}>
            <button class={next.view === "summary" ? "active" : undefined} type="button" onClick={() => setView("summary")}>{t("rewards.view.summary")}</button>
            <button class={next.view === "recent" ? "active" : undefined} type="button" onClick={() => setView("recent")}>{t("rewards.view.recent")}</button>
            <button class={next.view === "trends" ? "active" : undefined} type="button" onClick={() => setView("trends")}>{t("rewards.view.trends")}</button>
            <button class={next.view === "xpTracker" ? "active" : undefined} type="button" onClick={() => setView("xpTracker")}>{t("rewards.view.xpTracker")}</button>
          </div>
          <StatusDot tone={STATUS_TONE[next.status]} detail={[next.statusDetail, ...next.statusDetailExtras ?? []].map((part) => t.text(part)).join(" · ")} />
          <div class="toolbar-actions">
            <button class="btn" type="button" onClick={() => void desktopView.rpc?.request.openCatalog({})}>{t("rewards.action.catalog")}</button>
            <button class={next.mode === "replay" ? "btn active" : "btn"} type="button" onClick={() => void desktopView.rpc?.request.openReplayPicker({})}>{t("rewards.action.replay")}</button>
            <button class="btn" type="button" disabled={next.mode === "replay" || next.resetting} onClick={() => void desktopView.rpc?.request.resetSession({})}>{t("rewards.action.reset")}</button>
          </div>
        </nav>

        {next.mode === "replay" && (
          <div class="banner is-info">
            <span>
              {t("rewards.replay.viewing", { file: next.replayFileName ?? t("rewards.replay.selectedLog") })}
              {next.replayWarnings > 0 ? ` · ${t.plural("rewards.status.malformed", next.replayWarnings)}` : ""}
            </span>
            <button class="btn" type="button" onClick={returnToLive}>{t("rewards.replay.return")}</button>
          </div>
        )}

        {next.storageWarning !== undefined && <div class="banner is-warn" aria-live="polite">{t.text(next.storageWarning)}</div>}

        <div class="table-scroll totals">
          <table class="data-table summary-table rewards-total-table" aria-label={t("rewards.totals.label")}>
            <thead><tr><th>{t("rewards.totals.characterXp")}</th><th>{t("rewards.totals.xpToLevel")}</th><th>{t("rewards.totals.jobXp")}</th><th>{t("rewards.totals.coins")}</th><th>{t("rewards.totals.unmatched")}</th></tr></thead>
            <tbody><tr><td>{format.format(next.totalExperience)}</td><td>{next.xpToLevelUp === undefined ? "—" : format.format(next.xpToLevelUp)}</td><td>{format.format(next.totalJobExperience)}</td><td class="is-value">{formatDecimal(next.totalCoins)}</td><td>{format.format(next.unmatched)}</td></tr></tbody>
          </table>
        </div>

        {next.unidentified > 0 && (
          <div class="banner is-warn">
            {t.plural("rewards.unidentified", next.unidentified, { count: format.format(next.unidentified) })}
          </div>
        )}

        <section hidden={next.view !== "summary"}>
          <div class="section-head"><h1>{t("rewards.summary.heading")}</h1><p>{t("rewards.summary.hint")}</p></div>
          {next.summaries.length === 0 && next.unmatchedDrops.length === 0 ? (
              <div class="empty-state">{t(next.mode === "replay" ? "rewards.summary.emptyReplay" : "rewards.summary.empty")}</div>
            ) : (
              <div class="table-scroll rewards-table-scroll">
                <table class="data-table rewards-table" aria-label={t("rewards.summary.label")}>
                  <thead><tr>
                    <SortableHeader sortKey="displayName" sort={summarySort} onSort={sortSummariesBy} align="start">{t("rewards.column.mob")}</SortableHeader>
                    <SortableHeader sortKey="level" sort={summarySort} onSort={sortSummariesBy}>{t("rewards.column.level")}</SortableHeader>
                    <SortableHeader sortKey="kills" sort={summarySort} onSort={sortSummariesBy}>{t("rewards.column.kills")}</SortableHeader>
                    <SortableHeader sortKey="experience" sort={summarySort} onSort={sortSummariesBy}>{t("rewards.column.charXp")}</SortableHeader>
                    <SortableHeader sortKey="jobExperience" sort={summarySort} onSort={sortSummariesBy}>{t("rewards.column.jobXp")}</SortableHeader>
                    <SortableHeader sortKey="coins" sort={summarySort} onSort={sortSummariesBy}>{t("rewards.column.coins")}</SortableHeader>
                    <th>{t("rewards.column.drops")}</th>
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
                    {next.unmatchedDrops.length > 0 && <RewardRow rowKey="summary-unmatched" name={t("rewards.row.unmatched")} values={["—", "—", "—", "—", "—"]} drops={next.unmatchedDrops} expanded={expanded} onToggle={toggleExpanded} />}
                  </tbody>
                </table>
              </div>
            )}
        </section>

        <section hidden={next.view !== "recent"}>
          <div class="section-head"><h1>{t("rewards.recent.heading")}</h1><p>{t("rewards.recent.hint")}</p></div>
          {next.kills.length === 0 ? (
              <div class="empty-state">{t(next.mode === "replay" ? "rewards.recent.emptyReplay" : "rewards.recent.empty")}</div>
            ) : (
              <div class="table-scroll rewards-table-scroll">
                <table class="data-table rewards-table recent-rewards-table" aria-label={t("rewards.recent.label")}>
                  <thead><tr>
                    <SortableHeader sortKey="displayName" sort={killSort} onSort={sortKillsBy} align="start">{t("rewards.column.mob")}</SortableHeader>
                    <SortableHeader sortKey="level" sort={killSort} onSort={sortKillsBy}>{t("rewards.column.level")}</SortableHeader>
                    <SortableHeader sortKey="experience" sort={killSort} onSort={sortKillsBy}>{t("rewards.column.charXp")}</SortableHeader>
                    <SortableHeader sortKey="jobExperience" sort={killSort} onSort={sortKillsBy}>{t("rewards.column.jobXp")}</SortableHeader>
                    <SortableHeader sortKey="coins" sort={killSort} onSort={sortKillsBy}>{t("rewards.column.coins")}</SortableHeader>
                    <th>{t("rewards.column.drops")}</th>
                    <SortableHeader sortKey="timestamp" sort={killSort} onSort={sortKillsBy}>{t("rewards.column.timestamp")}</SortableHeader>
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
          <div class="section-head"><h1>{t("rewards.trends.heading")}</h1><p>{t("rewards.trends.hint")}</p></div>
          <TrendChart samples={next.graphSamples} replay={next.mode === "replay"} sessionKey={sessionKey} />
        </section>

        <section hidden={next.view !== "xpTracker"}>
          <div class="section-head">
            <h1>{t("rewards.xpTracker.heading")}</h1>
            <p>{t("rewards.xpTracker.hint")}</p>
          </div>
          <XpTrackerSection xp={next.xp} gold={next.gold} />
        </section>
      </main>
    </>
  );
}

function XpTrackerSection({ xp, gold }: { xp: RewardsAppState["xp"]; gold: RewardsAppState["gold"] }) {
  const t = useTranslator();
  const samples = bucketsToTrendSamples(xp.timeline);
  const computeRender = useCallback((range: TrendRange, width: number): ChartRenderResult => {
    const rates = buildRateTrend(samples, "experience", range, width);
    const maximum = rates.reduce((highest, point) => Math.max(highest, point.value), 0);
    return {
      points: rates.map((point) => ({
        time: point.time,
        ratio: maximum > 0 ? point.value / maximum : 0,
        primary: `${formatRate(point.value)}/sec`,
        secondary: t("rewards.trends.gain", { amount: format.format(point.gain), duration: formatTrendDuration(t, point.seconds) }),
      })),
      yLabels: axisTicks(5).map((tick) => formatRate((maximum * tick) / 4)),
    };
  }, [samples, t]);

  return (
    <>
      <div class="table-scroll totals">
        <table class="data-table summary-table rewards-total-table" aria-label={t("rewards.xpTracker.xpLabel")}>
          <thead><tr><th>{t("rewards.xpTracker.totalXp")}</th><th>{t("rewards.xpTracker.xpPerSec")}</th><th>{t("rewards.xpTracker.xpPerHour")}</th></tr></thead>
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
        <table class="data-table summary-table rewards-total-table" aria-label={t("rewards.xpTracker.goldLabel")}>
          <thead><tr><th>{t("rewards.xpTracker.totalGold")}</th><th>{t("rewards.xpTracker.goldPerSec")}</th><th>{t("rewards.xpTracker.goldPerHour")}</th></tr></thead>
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
        <button class="btn" type="button" onClick={() => void desktopView.rpc?.request.resetXpTracker({})}>{t("rewards.xpTracker.resetXp")}</button>
        <button class="btn" type="button" onClick={() => void desktopView.rpc?.request.resetGoldTracker({})}>{t("rewards.xpTracker.resetGold")}</button>
      </div>
      <InteractiveChart
        extent={trendExtent(samples)}
        computeRender={computeRender}
        stepped={false}
        emptyLabel={t("rewards.xpTracker.chartEmpty")}
        ariaLabel={t("rewards.xpTracker.chartAria")}
        resetKey="xp-tracker"
      />
    </>
  );
}

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

function safeDomId(value: string): string { return value.replace(/[^a-zA-Z0-9_-]/g, "-"); }

interface TrendChartProps {
  samples: readonly TrendSample[];
  replay: boolean;
  sessionKey: string;
}

function TrendChart({ samples, replay, sessionKey }: TrendChartProps) {
  const t = useTranslator();
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
          secondary: t("rewards.trends.total", { metric: t(METRIC_LABEL_KEYS[metric]) }),
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
        secondary: `${formatDecimal(point.gain.toString())} in ${formatTrendDuration(t, point.seconds)}`,
      })),
      yLabels: axisTicks(5).map((tick) => formatRate((maximum * tick) / 4)),
    };
  }, [samples, metric, mode, t]);

  const chartTitle = t(mode === "rate" ? "rewards.trends.ariaRate" : "rewards.trends.ariaCumulative", { metric: t(METRIC_LABEL_KEYS[metric]) });
  const emptyLabel = t(replay ? "rewards.trends.emptyReplay" : "rewards.trends.empty");

  return (
    <>
      <div class="trend-controls">
        <div class="seg" aria-label={t("rewards.trends.metricLabel")}>
          <button class={metric === "experience" ? "active" : undefined} type="button" onClick={() => setMetric("experience")}>{t("rewards.trends.metric.experience")}</button>
          <button class={metric === "jobExperience" ? "active" : undefined} type="button" onClick={() => setMetric("jobExperience")}>{t("rewards.trends.metric.jobExperience")}</button>
          <button class={metric === "coins" ? "active" : undefined} type="button" onClick={() => setMetric("coins")}>{t("rewards.trends.metric.coins")}</button>
        </div>
        <div class="seg" aria-label={t("rewards.trends.modeLabel")}>
          <button class={mode === "rate" ? "active" : undefined} type="button" onClick={() => setMode("rate")}>{t("rewards.trends.mode.rate")}</button>
          <button class={mode === "cumulative" ? "active" : undefined} type="button" onClick={() => setMode("cumulative")}>{t("rewards.trends.mode.cumulative")}</button>
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

const METRIC_LABEL_KEYS: Record<TrendMetric, MessageKey> = {
  experience: "rewards.trends.metric.experience",
  jobExperience: "rewards.trends.metric.jobExperience",
  coins: "rewards.trends.metric.coins",
};

function formatRate(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: value < 10 ? 2 : 1 }).format(value);
}

function formatTrendDuration(t: Translator, seconds: number): string {
  const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
  return seconds >= 60
    ? t("rewards.trends.minutes", { value: decimal.format(seconds / 60) })
    : t("rewards.trends.seconds", { value: decimal.format(seconds) });
}

function axisTicks(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

render(<App />, document.getElementById("root")!);
