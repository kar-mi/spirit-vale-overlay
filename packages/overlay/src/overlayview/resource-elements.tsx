import { useCallback } from "preact/hooks";
import { formatCompact, formatInteger } from "@svoverlay/ui-kit/format";
import { InteractiveChart, type ChartRange, type ChartRenderResult } from "@svoverlay/ui-kit/interactive-chart";
import { ewmaSeries } from "@kar-mi/spirit-vale-tools-metrics";
import type { OverlayResource } from "../app-types.ts";
import { resourceFill } from "../personal-resources.ts";
import { OverlayElement } from "./overlay-element.tsx";
import { characterState, electroview, weightWarn } from "./renderer-state.ts";
import { WaitingForData } from "./meter-elements.tsx";

export function WeightOverlayElement({ locked }: { locked: boolean }) {
  return <OverlayElement id="weight" locked={locked} weightWarn={weightWarn.value}><WeightElement /></OverlayElement>;
}

function WeightElement() {
  const weight = characterState.value?.weight;
  return (
    <div class={`weight-value${weight ? "" : " weight-waiting"}`}>
      <strong class="weight-label">Weight</strong>
      {weight ? <span class="weight-numbers" aria-label={`Weight ${weight.current} of ${weight.maximum}`}>
        <strong>{formatInteger(weight.current)}</strong><span>/</span><strong>{formatInteger(weight.maximum)}</strong>
      </span> : <span class="weight-empty">Waiting</span>}
    </div>
  );
}

export function RateTrackerElement({ kind, locked }: { kind: "xp" | "gold"; locked: boolean }) {
  const tracker = characterState.value?.[kind];
  const noun = kind === "xp" ? "XP" : "gold";
  if (!tracker) return <WaitingForData label={`Waiting for ${noun}`} />;
  const reset = kind === "xp"
    ? () => electroview.rpc?.request.resetXpTracker({})
    : () => electroview.rpc?.request.resetGoldTracker({});
  return (
    <div class={`element-content ${kind}-tracker`}>
      <h2 class="element-title">{kind === "xp" ? "Character XP" : "Gold dropped"}</h2>
      <div class={`${kind}-total`}><small>Total</small>{formatCompact(tracker.total)}</div>
      <div class={`${kind}-rates`}>
        <span>{formatCompact(tracker.perSecond)}<small>/s</small></span>
        <span>{formatCompact(tracker.perHour)}<small>/hr</small></span>
      </div>
      {!locked && <button class={`${kind}-reset-button`} type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => {
        void reset()?.then((nextState) => { characterState.value = nextState; });
      }}>Reset</button>}
    </div>
  );
}

export function XpChartElement() {
  const buckets = characterState.value?.xp.timeline ?? [];
  const rangeEnd = Date.now();
  const computeRender = useCallback((range: ChartRange, _width: number): ChartRenderResult => {
    const rates = ewmaSeries(buckets, range);
    const maximum = rates.reduce((highest, point) => Math.max(highest, point.value), 0);
    return {
      points: rates.map((point) => ({ time: point.time, ratio: maximum > 0 ? point.value / maximum : 0, primary: `${formatCompact(point.value)}/sec`, secondary: "20-second EWMA" })),
      yLabels: Array.from({ length: 5 }, (_, tick) => formatCompact((maximum * tick) / 4)),
    };
  }, [buckets]);
  return (
    <div class="element-content xp-chart">
      <h2 class="element-title">Character XP over time</h2>
      <InteractiveChart
        extent={{ start: rangeEnd - 10 * 60_000, end: rangeEnd }}
        computeRender={computeRender}
        stepped={false}
        emptyLabel="Waiting for XP"
        ariaLabel="Character XP rate over time"
        resetKey="xp-chart"
        interactive={false}
        xAxisTickCount={2}
      />
    </div>
  );
}

export type ResourceKind = "health" | "mana" | "character-xp" | "job-xp";

function ResourceElement({ kind, resource }: { kind: ResourceKind; resource: OverlayResource | undefined }) {
  const label = kind === "health" ? "HP" : kind === "mana" ? "MP" : kind === "character-xp" ? "XP" : "JOB XP";
  return (
    <div class={`resource-value resource-${kind}${resource ? "" : " resource-waiting"}`} style={`--resource-fill:${resource ? resourceFill(resource) : 0}`} aria-label={resource ? `${label} ${resource.current} of ${resource.maximum}` : `Waiting for ${label}`}>
      <strong class="resource-label">{label}</strong>
      {resource ? <span class="resource-numbers"><strong>{formatInteger(resource.current)}</strong><span>/</span><strong>{formatInteger(resource.maximum)}</strong></span> : <span class="resource-empty">Waiting</span>}
    </div>
  );
}

export function CharacterResourceElement({ kind }: { kind: ResourceKind }) {
  const next = characterState.value;
  const resource = kind === "health" ? next?.health : kind === "mana" ? next?.mana : kind === "character-xp" ? next?.characterXp : next?.jobXp;
  return <ResourceElement kind={kind} resource={resource} />;
}
