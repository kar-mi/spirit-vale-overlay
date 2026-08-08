import { expect, test } from "bun:test";
import type { CombatEncounterRecord, FishNetDpsActorRow, FishNetDpsEncounterSnapshot } from "@kar-mi/spirit-vale-tools-combat";

import { emptyMeterState, overlayMeterState } from "./meter-presentation.ts";

test("meter presentation sends only the selected chart, bounded rows, and damage personal summary", () => {
  const damage = snapshot("damage", 100, Array.from({ length: 14 }, (_, index) => actor(index + 1, 14 - index)));
  damage.personal = damage.actors[0];
  const healing = snapshot("healing", 200, [actor(90, 25)]);
  healing.personal = healing.actors[0];
  const tanked = snapshot("tanked", 300, [actor(91, 35)]);
  const record = combatRecord(damage, tanked, healing);

  const state = overlayMeterState(record, "heal", 1_000);

  expect(state.personalChart).toBe(true);
  expect(state.chart).toEqual([{ elapsedMs: 0, dps: 25 }]);
  expect(state.party).toEqual([{ actorId: 90, displayName: "Player 90", archetype: 2, dps: 25 }]);
  expect(state.personal).toEqual({ archetype: 2, currentDps: 14, damage: 140, critRate: 0.5 });
  expect(JSON.stringify(state)).not.toContain("skills");
  expect(JSON.stringify(state).length).toBeLessThan(JSON.stringify(record).length / 2);
});

test("meter presentation aggregates a map chart and limits rankings to twelve active actors", () => {
  const damage = snapshot("damage", 100, [actor(1, 4), actor(2, 8)]);
  const selected = snapshot("healing", 200, [
    ...Array.from({ length: 13 }, (_, index) => actor(index + 1, index + 1)),
    { ...actor(99, 999), lastDamageAtMs: -60_001 },
  ]);
  const state = overlayMeterState(combatRecord(damage, damage, selected), "heal", 0);

  expect(state.personalChart).toBe(false);
  expect(state.chart).toEqual([{ elapsedMs: 0, dps: 1_090 }]);
  expect(state.party).toHaveLength(12);
  expect(state.party.map((row) => row.actorId)).toEqual([13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
});

test("empty meter presentation has stable empty fields", () => {
  expect(overlayMeterState(undefined, "damage", 0)).toEqual(emptyMeterState());
});

function combatRecord(
  dps: FishNetDpsEncounterSnapshot,
  tanked: FishNetDpsEncounterSnapshot,
  healing: FishNetDpsEncounterSnapshot,
): CombatEncounterRecord {
  return {
    dps,
    tps: { id: tanked.id, startedAtMs: 0, lastEventAtMs: 1_000, durationMs: tanked.durationMs, total: 0, rate: 0, rows: [], detail: tanked },
    hps: { id: healing.id, startedAtMs: 0, lastEventAtMs: 1_000, durationMs: healing.durationMs, total: 0, rate: 0, rows: [], detail: healing },
  };
}

function snapshot(id: string, durationMs: number, actors: FishNetDpsActorRow[]): FishNetDpsEncounterSnapshot {
  return {
    id,
    startedAtMs: 0,
    lastDamageAtMs: 0,
    durationMs,
    totalDamage: 0,
    partyDps: 0,
    partyCurrentDps: 0,
    actors,
    unidentifiedActorIds: [],
    personalName: "Player 1",
    personalMatch: "missing",
  };
}

function actor(actorId: number, dps: number): FishNetDpsActorRow {
  return {
    actorIds: [actorId],
    displayName: `Player ${actorId}`,
    archetype: 2,
    durationMs: 100,
    lastDamageAtMs: 0,
    damage: dps * 10,
    dps,
    currentDps: dps,
    contribution: 0,
    hits: 1,
    criticalHits: 0,
    critRate: 0.5,
    kills: 0,
    mobsHit: 1,
    skills: [{ sourceId: "unused", sourceLabel: "Unused", damage: 1, dps: 1, contribution: 1, hits: 1, criticalHits: 0 }],
    timeline: [{ elapsedMs: 0, damage: dps, cumulativeDamage: dps, dps }],
  };
}
