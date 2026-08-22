import type {
  CombatEncounterRecord,
  FishNetDpsEncounterSnapshot,
} from "@kar-mi/spirit-vale-tools-combat";

import type { OverlayMeterPoint, OverlayMeterState, PersonalDpsMode, StatType } from "./app-types.ts";
import { visiblePartyActors } from "./overlayview/party-ranking.ts";

export function overlayMeterState(
  record: CombatEncounterRecord | undefined,
  statType: StatType,
  nowMs: number,
  personalDpsMode: PersonalDpsMode,
): OverlayMeterState {
  if (!record) return emptyMeterState();

  const selected = statType === "tanked" ? record.tps.detail
    : statType === "heal" ? record.hps.detail
    : record.dps;
  const chartSource = selected.personal;
  const chart = chartSource?.timeline ?? partyTimeline(selected);
  const personal = record.dps.personal;

  return {
    personalChart: chartSource !== undefined,
    chartDurationMs: chartSource?.durationMs ?? selected.durationMs,
    chart: chart.map(({ elapsedMs, dps }) => ({ elapsedMs, dps })),
    partyDurationMs: selected.durationMs,
    party: visiblePartyActors(selected.actors, nowMs)
      .map((actor) => ({
        actorId: actor.actorIds[0] ?? 0,
        displayName: actor.displayName,
        ...(actor.archetype === undefined ? {} : { archetype: actor.archetype }),
        dps: actor.dps,
      })),
    ...(personal === undefined ? {} : {
      personal: {
        ...(personal.archetype === undefined ? {} : { archetype: personal.archetype }),
        currentDps: personalDpsMode === "live" ? personal.currentDps : personal.dps,
        damage: personal.damage,
        ...(personal.critRate === undefined ? {} : { critRate: personal.critRate }),
        durationMs: personal.durationMs ?? 0,
      },
    }),
  };
}

export function emptyMeterState(): OverlayMeterState {
  return {
    personalChart: false,
    chartDurationMs: 0,
    chart: [],
    partyDurationMs: 0,
    party: [],
  };
}

function partyTimeline(snapshot: FishNetDpsEncounterSnapshot): OverlayMeterPoint[] {
  const buckets = new Map<number, number>();
  for (const actor of snapshot.actors) {
    for (const point of actor.timeline) {
      buckets.set(point.elapsedMs, (buckets.get(point.elapsedMs) ?? 0) + point.dps);
    }
  }
  return [...buckets]
    .sort(([left], [right]) => left - right)
    .map(([elapsedMs, dps]) => ({ elapsedMs, dps }));
}
