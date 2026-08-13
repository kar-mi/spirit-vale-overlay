import { formatDps, formatDuration, formatCompact } from "@svoverlay/ui-kit/format";
import { TimelineChart } from "@svoverlay/ui-kit/timeline-chart";
import { classIconUrl } from "@svoverlay/ui-kit/class-icon";
import { meterLabels } from "@svoverlay/ui-kit/meter-labels";
import { chromeState, meterState } from "./renderer-state.ts";

const PARTY_ROW_COLORS = [
  "rgba(111, 91, 211, 0.52)", "rgba(40, 132, 210, 0.52)", "rgba(27, 151, 135, 0.52)",
  "rgba(213, 130, 42, 0.52)", "rgba(193, 71, 139, 0.52)", "rgba(99, 153, 52, 0.52)",
  "rgba(190, 74, 69, 0.52)", "rgba(181, 151, 45, 0.52)",
] as const;

export function DpsChartElement() {
  const meter = meterState.value;
  const metricLabel = meterLabels(chromeState.value!.meterStatType).rate;
  const points = meter?.chart ?? [];
  const duration = meter?.chartDurationMs ?? 0;
  return (
    <div class="element-content">
      <h2 class="element-title">{meter?.personalChart ? `Personal ${metricLabel} over time` : `Map ${metricLabel} over time`}</h2>
      {points.length ? (
        <TimelineChart
          points={points.map((point) => ({ elapsedMs: point.elapsedMs, value: point.dps }))}
          durationMs={duration}
          label={metricLabel}
          width={640}
          height={220}
          layout={{ left: 42, top: 12, right: 12, bottom: 26 }}
          bottomLabelOffset={5}
        />
      ) : <WaitingForData />}
    </div>
  );
}

export function PersonalDpsElement() {
  const personal = meterState.value?.personal;
  const personalDpsMode = chromeState.value?.personalDpsMode;
  return (
    <div class="element-content">
      <div class="personal-heading">
        <img class="personal-class-icon" src={classIconUrl(personal?.archetype)} alt="" aria-hidden="true" />
        <div>
          <h2 class="element-title">{personalDpsMode === "live" ? "Live DPS" : "Encounter DPS"}</h2>
          {personalDpsMode !== "live" && <span class="personal-duration">{formatDuration(personal?.durationMs ?? 0)}</span>}
        </div>
      </div>
      {personal ? (
        <>
          <span class="personal-value">{formatDps(personal.currentDps)}</span><span class="personal-unit">DPS</span>
          <div class="personal-details">
            <span>Damage<strong>{formatCompact(personal.damage)}</strong></span>
            <span>Crit rate<strong>{personal.critRate === undefined ? "—" : `${Math.round(personal.critRate * 100)}%`}</strong></span>
          </div>
        </>
      ) : <WaitingForData />}
    </div>
  );
}

export function PartyRankingElement() {
  const meter = meterState.value;
  const control = chromeState.value!;
  const metricLabel = meterLabels(control.meterStatType).rate;
  const actors = meter?.party ?? [];
  const maxDps = Math.max(1, ...actors.map((actor) => actor.dps));
  return (
    <div class="element-content">
      <div class="party-heading">
        <div><h2 class="element-title">Map encounter {metricLabel}</h2><span class="party-duration">{formatDuration(meter?.partyDurationMs ?? 0)}</span></div>
        <span class="party-reset-hint">{control.shortcuts.resetSession} to reset · {control.shortcuts.cycleMeterStatType} to switch</span>
      </div>
      {actors.length ? <div class="ranking">{actors.map((actor, index) => (
        <div class="ranking-row" key={actor.actorId} style={`--row-fill:${actor.dps / maxDps * 100}%;--row-color:${PARTY_ROW_COLORS[index % PARTY_ROW_COLORS.length]}`}>
          <span class="ranking-player">
            <img class="ranking-class-icon" src={classIconUrl(actor.archetype)} alt="" aria-hidden="true" />
            <span class="ranking-rank">{index + 1}.</span><span class="ranking-name">{actor.displayName}</span>
          </span>
          <span class="ranking-dps">{formatDps(actor.dps)}</span>
        </div>
      ))}</div> : <WaitingForData />}
    </div>
  );
}

export function WaitingForData({ label = "Waiting for DPS" }: { label?: string } = {}) {
  return <div class="empty"><span>{label}</span><span class="empty-help">Press F11 to toggle edit mode, or open Settings from any app window</span></div>;
}
