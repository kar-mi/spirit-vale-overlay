import { useCallback, useState } from "preact/hooks";
import { InteractiveChart, type ChartRenderResult } from "@svoverlay/ui-kit/interactive-chart";
import { bigintRatio, buildCumulativeTrend, buildRateTrend, trendExtent } from "@kar-mi/spirit-vale-tools-rewards";
import type { TrendMetric, TrendMode, TrendRange, TrendSample } from "@kar-mi/spirit-vale-tools-rewards";
import type { RateSnapshot } from "@kar-mi/spirit-vale-tools-metrics";
import type { RewardsAppState } from "../app-types.ts";

const integerFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function XpTrackerSection({ xp, gold, onResetXp, onResetGold }: { xp: RewardsAppState["xp"]; gold: RewardsAppState["gold"]; onResetXp(): void; onResetGold(): void }) {
  const samples = bucketsToTrendSamples(xp.timeline);
  const computeRender = useCallback((range: TrendRange, width: number): ChartRenderResult => {
    const rates = buildRateTrend(samples, "experience", range, width);
    const maximum = rates.reduce((highest, point) => Math.max(highest, point.value), 0);
    return {
      points: rates.map((point) => ({ time: point.time, ratio: maximum > 0 ? point.value / maximum : 0, primary: `${formatRate(point.value)}/sec`, secondary: `${integerFormat.format(point.gain)} XP in ${formatTrendDuration(point.seconds)}` })),
      yLabels: axisTicks(5).map((tick) => formatRate((maximum * tick) / 4)),
    };
  }, [samples]);
  return <>
    <TrackerTotals label="All-time XP totals" headers={["Total XP", "XP / sec", "XP / hr"]} values={[xp.total, xp.perSecond, xp.perHour]} />
    <TrackerTotals label="All-time gold totals" headers={["Total gold", "Gold / sec", "Gold / hr"]} values={[gold.total, gold.perSecond, gold.perHour]} />
    <div class="xp-tracker-actions">
      <button class="btn" type="button" onClick={onResetXp}>Reset all-time XP</button>
      <button class="btn" type="button" onClick={onResetGold}>Reset all-time gold</button>
    </div>
    <InteractiveChart extent={trendExtent(samples)} computeRender={computeRender} stepped={false} emptyLabel="XP gained will appear here as a graph once there's enough recent activity." ariaLabel="Character XP rate over time" resetKey="xp-tracker" />
  </>;
}

function TrackerTotals({ label, headers, values }: { label: string; headers: readonly string[]; values: readonly number[] }) {
  return <div class="table-scroll totals"><table class="data-table summary-table rewards-total-table" aria-label={label}><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody><tr>{values.map((value, index) => <td key={headers[index]}>{integerFormat.format(value)}</td>)}</tr></tbody></table></div>;
}

function bucketsToTrendSamples(buckets: RateSnapshot["timeline"]): TrendSample[] {
  return buckets.map((bucket) => ({ recordedAt: new Date(bucket.atMs).toISOString(), experience: bucket.value, jobExperience: 0, coins: "0" }));
}

export function TrendChart({ samples, replay, sessionKey }: { samples: readonly TrendSample[]; replay: boolean; sessionKey: string }) {
  const [metric, setMetric] = useState<TrendMetric>("experience");
  const [mode, setMode] = useState<TrendMode>("rate");
  const computeRender = useCallback((range: TrendRange, width: number): ChartRenderResult => {
    if (mode === "cumulative") {
      const cumulative = buildCumulativeTrend(samples, metric, range);
      const maximum = cumulative.reduce((highest, point) => point.value > highest ? point.value : highest, 0n);
      return {
        points: cumulative.map((point) => ({ time: point.time, ratio: bigintRatio(point.value, maximum), primary: formatDecimal(point.value.toString()), secondary: `${metricLabel(metric)} total` })),
        yLabels: axisTicks(5).map((tick) => formatDecimal((maximum * BigInt(tick) / 4n).toString())),
      };
    }
    const rates = buildRateTrend(samples, metric, range, width);
    const maximum = rates.reduce((highest, point) => Math.max(highest, point.value), 0);
    return {
      points: rates.map((point) => ({ time: point.time, ratio: maximum > 0 ? point.value / maximum : 0, primary: `${formatRate(point.value)}/sec`, secondary: `${formatDecimal(point.gain.toString())} in ${formatTrendDuration(point.seconds)}` })),
      yLabels: axisTicks(5).map((tick) => formatRate((maximum * tick) / 4)),
    };
  }, [samples, metric, mode]);
  const chartTitle = `${metricLabel(metric)} ${mode === "rate" ? "rate per second" : "cumulative total"} over time`;
  return <>
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
    <InteractiveChart extent={trendExtent(samples)} computeRender={computeRender} stepped={mode === "cumulative"} emptyLabel={replay ? "No timestamped rewards in this replay." : "Confirmed rewards will appear here."} ariaLabel={chartTitle} resetKey={`${sessionKey}:${metric}:${mode}`} />
  </>;
}

export function formatDecimal(value: string): string {
  try { return integerFormat.format(BigInt(value)); } catch { return value; }
}

function metricLabel(metric: TrendMetric): string {
  return metric === "experience" ? "Character XP" : metric === "jobExperience" ? "Job XP" : "Coins";
}

function formatRate(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: value < 10 ? 2 : 1 }).format(value);
}

function formatTrendDuration(seconds: number): string {
  const format = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
  return seconds >= 60 ? `${format.format(seconds / 60)} min` : `${format.format(seconds)} sec`;
}

function axisTicks(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}
