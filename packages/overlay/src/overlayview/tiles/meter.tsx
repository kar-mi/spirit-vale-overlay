import { useTranslator } from "@svoverlay/i18n/browser";
import { formatCompact, formatDps, formatDuration } from "@svoverlay/ui-kit/format";
import type { OverlayMeterPoint } from "../../app-types.ts";
import type { OverlayChrome } from "../store.ts";
import { chromeState, meterState } from "../store.ts";
import { WaitingForDps, overlayClassIcon } from "./common.tsx";

const PARTY_ROW_COLORS = [
  "rgba(111, 91, 211, 0.52)", "rgba(40, 132, 210, 0.52)",
  "rgba(27, 151, 135, 0.52)", "rgba(213, 130, 42, 0.52)",
  "rgba(193, 71, 139, 0.52)", "rgba(99, 153, 52, 0.52)",
  "rgba(190, 74, 69, 0.52)", "rgba(181, 151, 45, 0.52)",
] as const;

function meterMetricLabel(next: OverlayChrome): string {
  return next.meterStatType === "tanked" ? "TPS" : next.meterStatType === "heal" ? "HPS" : "DPS";
}

export function DpsChartElement() {
  const t = useTranslator();
  const meter = meterState.value;
  const control = chromeState.value!;
  const metricLabel = meterMetricLabel(control);
  const points = meter?.chart ?? [];
  const duration = meter?.chartDurationMs ?? 0;
  return (
    <div class="element-content">
      <h2 class="element-title">{t(meter?.personalChart ? "overlay.chart.personal" : "overlay.chart.map", { metric: metricLabel })}</h2>
      {points.length ? <DamageChart points={points} durationMs={duration} metricLabel={metricLabel} /> : <WaitingForDps />}
    </div>
  );
}

function DamageChart(
  { points, durationMs, metricLabel }: { points: readonly OverlayMeterPoint[]; durationMs: number; metricLabel: string },
) {
  const t = useTranslator();
  const width = 640;
  const height = 220;
  const left = 42;
  const top = 12;
  const right = 12;
  const bottom = 26;
  const maxValue = Math.max(1, ...points.map((point) => point.dps));
  const duration = Math.max(1, durationMs);
  const linePoints = points.map((point) => {
    const x = left + (point.elapsedMs / duration) * (width - left - right);
    const y = top + (1 - point.dps / maxValue) * (height - top - bottom);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg class="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("overlay.chart.aria", { metric: metricLabel })}>
      <line class="chart-grid" x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} />
      <polyline class="chart-line" points={linePoints} />
      <text class="chart-label" x="0" y={top + 4}>{formatCompact(maxValue)}</text>
      <text class="chart-label" x={left} y={height - 5}>0:00</text>
      <text class="chart-label" text-anchor="end" x={width - right} y={height - 5}>{formatDuration(durationMs)}</text>
    </svg>
  );
}

export function PersonalDpsElement() {
  const t = useTranslator();
  const personal = meterState.value?.personal;
  const personalDpsMode = chromeState.value?.personalDpsMode;
  return (
    <div class="element-content">
      <div class="personal-heading">
        <img class="personal-class-icon" src={overlayClassIcon(personal?.archetype)} alt="" aria-hidden="true" />
        <div>
          <h2 class="element-title">{t(personalDpsMode === "live" ? "overlay.personal.live" : "overlay.personal.encounter")}</h2>
          {personalDpsMode !== "live" && <span class="personal-duration">{formatDuration(personal?.durationMs ?? 0)}</span>}
        </div>
      </div>
      {personal ? (
        <>
          <span class="personal-value">{formatDps(personal.currentDps)}</span><span class="personal-unit">{t("overlay.personal.unit")}</span>
          <div class="personal-details">
            <span>{t("overlay.personal.damage")}<strong>{formatCompact(personal.damage)}</strong></span>
            <span>{t("overlay.personal.critRate")}<strong>{personal.critRate === undefined ? "—" : `${Math.round(personal.critRate * 100)}%`}</strong></span>
          </div>
        </>
      ) : <WaitingForDps />}
    </div>
  );
}


export function PartyRankingElement() {
  const t = useTranslator();
  const meter = meterState.value;
  const control = chromeState.value!;
  const metricLabel = meterMetricLabel(control);
  const actors = meter?.party ?? [];
  const maxDps = Math.max(1, ...actors.map((actor) => actor.dps));
  const duration = meter?.partyDurationMs ?? 0;
  return (
    <div class="element-content">
      <div class="party-heading">
        <div>
          <h2 class="element-title">{t("overlay.party.heading", { metric: metricLabel })}</h2>
          <span class="party-duration">{formatDuration(duration)}</span>
        </div>
        <span class="party-reset-hint">{t("overlay.party.resetHint", { reset: control.shortcuts.resetSession, cycle: control.shortcuts.cycleMeterStatType })}</span>
      </div>
      {actors.length ? <div class="ranking">{actors.map((actor, index) => (
        <div
          class="ranking-row"
          key={actor.actorId}
          style={`--row-fill:${actor.dps / maxDps * 100}%;--row-color:${PARTY_ROW_COLORS[index % PARTY_ROW_COLORS.length]}`}
        >
          <span class="ranking-player">
            <img class="ranking-class-icon" src={overlayClassIcon(actor.archetype)} alt="" aria-hidden="true" />
            <span class="ranking-rank">{index + 1}.</span>
            <span class="ranking-name">{actor.displayName}</span>
          </span>
          <span class="ranking-dps">{formatDps(actor.dps)}</span>
        </div>
      ))}</div> : <WaitingForDps />}
    </div>
  );
}
