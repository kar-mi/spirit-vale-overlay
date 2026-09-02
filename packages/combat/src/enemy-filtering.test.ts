import { describe, expect, test } from "bun:test";

import type { CombatAnalysisState, MeterActorRow } from "./app-types.ts";
import { applyEnemyFilter } from "./enemy-filtering.ts";

function actor(rowId: string, displayName: string, damage: number, actorId = 7): MeterActorRow {
  return {
    rowId,
    actorIds: [actorId],
    displayName,
    durationMs: 10_000,
    damage,
    dps: damage / 10,
    currentDps: 0,
    contribution: 0,
    hits: 1,
    criticalHits: 0,
    kills: 0,
    mobsHit: 1,
    skills: [],
    timeline: [],
  };
}

function state(actors: MeterActorRow[]): CombatAnalysisState {
  return {
    status: "ready",
    statusDetail: { code: "combat.status.loadingLog" },
    invalidLines: 0,
    encounters: [],
    statType: "damage",
    snapshot: {
      id: "encounter-1",
      startedAtMs: 0,
      lastDamageAtMs: 10_000,
      endedAtMs: 10_000,
      durationMs: 10_000,
      totalDamage: actors.reduce((sum, row) => sum + row.damage, 0),
      partyDps: 0,
      partyCurrentDps: 0,
      actors,
      unidentifiedActorIds: [7],
      personalName: "",
      personalMatch: "unconfigured",
    },
    enemies: [{ targetId: 90, label: "Construct A" }, { targetId: 91, label: "Construct B" }],
    actorEnemyBreakdown: {
      unidentified: [{ targetId: 90, damage: 15_200, hits: 28, criticalHits: 0 }],
      "name:bramble": [{ targetId: 91, damage: 118_200, hits: 4, criticalHits: 0 }],
    },
    tankedEnemies: [],
    tankedActorEnemyBreakdown: {},
  };
}

describe("enemy filtering", () => {
  test("does not duplicate a reused actor id between identified and unidentified rows", () => {
    const actors = [actor("unidentified", "Unidentified", 15_200), actor("name:bramble", "Bramble", 118_200)];
    const filtered = applyEnemyFilter(state(actors), actors, new Set([91]));

    expect(filtered.map((row) => [row.actor.rowId, row.damage, row.hits, row.contribution])).toEqual([
      ["name:bramble", 118_200, 4, 1],
    ]);
  });

  test("hides actors with no damage against the selected enemies", () => {
    const actors = [actor("name:aurora", "Aurora", 100, 1), actor("name:bramble", "Bramble", 300, 2)];
    const next = state(actors);
    next.actorEnemyBreakdown = {
      "name:aurora": [{ targetId: 90, damage: 100, hits: 2, criticalHits: 1 }],
      "name:bramble": [{ targetId: 91, damage: 300, hits: 3, criticalHits: 0 }],
    };

    const filtered = applyEnemyFilter(next, actors, new Set([90]));
    expect(filtered.map((row) => row.actor.rowId)).toEqual(["name:aurora"]);
  });

  test("computes share from total party damage against the selected enemies", () => {
    const actors = [actor("name:aurora", "Aurora", 100, 1), actor("name:bramble", "Bramble", 300, 2)];
    const next = state(actors);
    next.actorEnemyBreakdown = {
      "name:aurora": [{ targetId: 90, damage: 100, hits: 2, criticalHits: 1 }],
      "name:bramble": [{ targetId: 90, damage: 300, hits: 3, criticalHits: 0 }],
    };

    const filtered = applyEnemyFilter(next, actors, new Set([90]));
    expect(filtered.map((row) => row.contribution)).toEqual([0.25, 0.75]);
    expect(filtered.reduce((sum, row) => sum + row.contribution, 0)).toBe(1);
    expect(filtered[0]).toMatchObject({ dps: 10, hits: 2, criticalHits: 1, critRate: 0.5 });
  });

  test("filters the tanked meter by attacker, reading the tanked breakdown and duration", () => {
    const actors = [actor("name:aurora", "Aurora", 400, 1), actor("name:bramble", "Bramble", 100, 2)];
    const next = state(actors);
    next.statType = "tanked";
    next.tankedSnapshot = { ...next.snapshot!, durationMs: 20_000 };
    next.tankedActorEnemyBreakdown = {
      "name:aurora": [{ targetId: 500, damage: 400, hits: 4, criticalHits: 0 }],
      "name:bramble": [{ targetId: 501, damage: 100, hits: 1, criticalHits: 0 }],
    };

    const filtered = applyEnemyFilter(next, actors, new Set([500]));
    expect(filtered.map((row) => [row.actor.rowId, row.damage, row.dps])).toEqual([["name:aurora", 400, 20]]);
    expect(filtered[0]?.contribution).toBe(1);
  });

  test("passes tanked rows through untouched when nothing is selected", () => {
    const actors = [actor("name:aurora", "Aurora", 400, 1)];
    const next = state(actors);
    next.statType = "tanked";
    const filtered = applyEnemyFilter(next, actors, new Set());
    expect(filtered[0]?.damage).toBe(400);
  });
});
