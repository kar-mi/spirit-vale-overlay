import { describe, expect, test } from "bun:test";

import type { MeterActorRow, MeterEncounterSnapshot } from "./app-types.ts";
import { buildLivePlayerDetailState } from "./live-player-detail.ts";

function actor(): MeterActorRow {
  return {
    actorIds: [42],
    displayName: "Healer",
    damage: 100,
    dps: 10,
    currentDps: 10,
    contribution: 1,
    hits: 2,
    criticalHits: 1,
    kills: 0,
    mobsHit: 1,
    skills: [],
    timeline: [],
  };
}

test("builds live detail for a player with no DPS row", () => {
  const healSnapshot: MeterEncounterSnapshot = {
    id: "encounter",
    startedAtMs: 0,
    lastDamageAtMs: 10_000,
    durationMs: 10_000,
    totalDamage: 100,
    partyDps: 10,
    partyCurrentDps: 10,
    actors: [actor()],
    personalName: "",
    personalMatch: "unconfigured",
  };
  const detail = buildLivePlayerDetailState({
    fileName: "combat.jsonl",
    healSnapshot,
    statType: "heal",
  }, 42);
  expect(detail?.player.displayName).toBe("Healer");
  expect(detail?.player.damage).toBe(0);
  expect(detail?.healPlayer?.damage).toBe(100);
  expect(detail?.selectedEnemyIds).toEqual([]);
  expect(detail?.enemies).toEqual([]);
});

describe("live detail actor selection", () => {
  test("returns no detail when the selected actor disappears", () => {
    expect(buildLivePlayerDetailState({ fileName: "combat.jsonl", statType: "damage" }, 42)).toBeUndefined();
  });
});
