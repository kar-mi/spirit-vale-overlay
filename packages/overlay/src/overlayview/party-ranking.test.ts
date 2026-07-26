import { expect, test } from "bun:test";

import type { FishNetDpsActorRow } from "@kar-mi/spirit-vale-tools-combat";
import { PARTY_ACTOR_IDLE_TIMEOUT_MS, visiblePartyActors } from "./party-ranking.ts";

test("party ranking uses encounter DPS and excludes inactive actors before sorting and limiting", () => {
  const actors = [
    actor(1, 0, 0),
    actor(2, 20, 20),
    actor(3, 80, 80),
    actor(4, 40, 40),
  ];

  expect(visiblePartyActors(actors, 60_000).map((row) => [row.actorIds[0], row.dps])).toEqual([
    [3, 80],
    [4, 40],
    [2, 20],
  ]);
  expect(actors.map((row) => row.actorIds[0])).toEqual([1, 2, 3, 4]);

  const crowdedParty = [actor(100, 0, 0), ...Array.from({ length: 14 }, (_, index) => actor(index + 1, index + 1, index + 1))];
  expect(visiblePartyActors(crowdedParty, 60_000).map((row) => row.actorIds[0])).toEqual([
    14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
  ]);
});

test("party ranking retains an actor through the 60-second idle boundary", () => {
  const row = actor(1, 200, 10_000);
  expect(visiblePartyActors([row], 10_000 + PARTY_ACTOR_IDLE_TIMEOUT_MS)).toEqual([row]);
  expect(visiblePartyActors([row], 10_001 + PARTY_ACTOR_IDLE_TIMEOUT_MS)).toEqual([]);
});

function actor(actorId: number, dps: number, lastDamageAtMs: number): FishNetDpsActorRow {
  return {
    actorIds: [actorId],
    displayName: `Fictional Player ${actorId}`,
    lastDamageAtMs,
    damage: dps,
    dps,
    currentDps: 0,
    contribution: 0,
    hits: 0,
    criticalHits: 0,
    kills: 0,
    mobsHit: 0,
    skills: [],
    timeline: [],
  };
}
