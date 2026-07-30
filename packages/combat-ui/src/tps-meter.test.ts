import { describe, expect, test } from "bun:test";
import type { FishNetActorIdentityEvent, FishNetCombatDamageEvent, FishNetCombatDeathEvent } from "@kar-mi/spirit-vale-tools-combat";

import { TpsMeter } from "./tps-meter.ts";

function identity(actorId: number, displayName: string): FishNetActorIdentityEvent {
  return { kind: "actorIdentity", operation: "upsert", tick: 1, actorId, displayName };
}

function removeIdentity(actorId: number): FishNetActorIdentityEvent {
  return { kind: "actorIdentity", operation: "remove", tick: 2, actorId };
}

function hit(
  targetId: number,
  actorId: number,
  value: number,
  team: number,
  sourceId = "Cleave",
  hitResult: "normal" | "critical" = "normal",
): FishNetCombatDamageEvent {
  return {
    kind: "damage",
    rpc: "ApplyDamage_C",
    tick: 1,
    payloadBytes: 0,
    fields: {},
    actorId,
    targetId,
    sourceId,
    sourceLabel: sourceId,
    value,
    hitResult,
    wireHits: 1,
    damageType: 0,
    team,
    element: 0,
    weaponType: 0,
    range: 0,
    isClone: false,
    isSummon: false,
    position: [],
    origin: [],
    attribution: "exact",
  };
}

function lethalHit(targetId: number, actorId: number, value: number, team: number, duplicates: boolean): FishNetCombatDeathEvent {
  const { position: _position, origin: _origin, ...rest } = hit(targetId, actorId, value, team);
  return { ...rest, kind: "death", rpc: "Death_C", duplicatesDamageEvent: duplicates };
}

const window = { id: "enc-1", startedAtMs: 0, endedAtMs: 10_000, durationMs: 10_000 };

describe("TpsMeter", () => {
  test("groups incoming damage by the party member taking the hit", () => {
    const meter = new TpsMeter();
    meter.consumeIdentity(identity(20, "Tank"));
    meter.consumeCombat(hit(20, 300, 50, 1), 1_000);
    meter.consumeCombat(hit(20, 300, 30, 1), 2_000);

    const snapshot = meter.getSnapshot(window, 10_000);
    expect(snapshot.actors).toHaveLength(1);
    expect(snapshot.actors[0]).toMatchObject({ displayName: "Tank", damage: 80, hits: 2, mobsHit: 1 });
  });

  test("merges respawned actor ids by trimmed, case-insensitive player name", () => {
    const meter = new TpsMeter();
    meter.consumeIdentity(identity(20, "Ember Sage"));
    meter.consumeCombat(hit(20, 300, 50, 1), 1_000);
    meter.consumeIdentity(identity(21, " ember sage "));
    meter.consumeCombat(hit(21, 301, 30, 1), 2_000);

    const snapshot = meter.getSnapshot(window, 10_000);
    expect(snapshot.actors).toHaveLength(1);
    expect(snapshot.actors[0]).toMatchObject({
      actorIds: [20, 21],
      displayName: "Ember Sage",
      damage: 80,
      hits: 2,
      mobsHit: 2,
    });
  });

  test("excludes team-0 events (the party's own outgoing damage)", () => {
    const meter = new TpsMeter();
    meter.consumeIdentity(identity(20, "Tank"));
    meter.consumeCombat(hit(20, 300, 50, 0), 1_000);

    const snapshot = meter.getSnapshot(window, 10_000);
    expect(snapshot.actors).toHaveLength(0);
    expect(snapshot.totalDamage).toBe(0);
  });

  test("excludes self-damage and non-positive values", () => {
    const meter = new TpsMeter();
    meter.consumeIdentity(identity(20, "Tank"));
    meter.consumeCombat(hit(20, 20, 50, 1), 1_000);
    meter.consumeCombat(hit(20, 300, 0, 1), 1_000);

    const snapshot = meter.getSnapshot(window, 10_000);
    expect(snapshot.actors).toHaveLength(0);
  });

  test("drops duplicate death events but keeps unpaired ones", () => {
    const meter = new TpsMeter();
    meter.consumeIdentity(identity(20, "Tank"));
    meter.consumeCombat(lethalHit(20, 300, 999, 1, true), 1_000);
    meter.consumeCombat(lethalHit(20, 300, 40, 1, false), 2_000);

    const snapshot = meter.getSnapshot(window, 10_000);
    expect(snapshot.actors[0]).toMatchObject({ damage: 40, hits: 1 });
  });

  test("buckets unidentified targets separately", () => {
    const meter = new TpsMeter();
    meter.consumeCombat(hit(99, 300, 50, 1), 1_000);

    const snapshot = meter.getSnapshot(window, 10_000);
    expect(snapshot.actors[0]).toMatchObject({ displayName: "Unidentified", isUnidentified: true });
  });

  test("retains the identity present when a hit was recorded", () => {
    const meter = new TpsMeter();
    meter.consumeIdentity(identity(10, "Tank"));
    meter.consumeCombat(hit(10, 300, 40, 1), 1_000);
    meter.consumeIdentity(removeIdentity(10));

    expect(meter.getSnapshot(window, 10_000).actors).toMatchObject([{ displayName: "Tank", isUnidentified: false, damage: 40 }]);
  });

  test("groups skill rows by the attacking source", () => {
    const meter = new TpsMeter();
    meter.consumeIdentity(identity(20, "Tank"));
    meter.consumeCombat(hit(20, 300, 50, 1, "Cleave"), 1_000);
    meter.consumeCombat(hit(20, 300, 25, 1, "Bite", "critical"), 2_000);

    const snapshot = meter.getSnapshot(window, 10_000);
    const skills = snapshot.actors[0]!.skills;
    expect(skills.find((skill) => skill.sourceId === "Cleave")).toMatchObject({ damage: 50, hits: 1 });
    expect(skills.find((skill) => skill.sourceId === "Bite")).toMatchObject({ damage: 25, hits: 1, criticalHits: 1 });
  });

  test("computes a timeline bucketed from the encounter start", () => {
    const meter = new TpsMeter({ timelineBucketMs: 5_000 });
    meter.consumeIdentity(identity(20, "Tank"));
    meter.consumeCombat(hit(20, 300, 50, 1), 1_000);
    meter.consumeCombat(hit(20, 300, 30, 1), 6_000);

    const timeline = meter.getSnapshot(window, 10_000).actors[0]!.timeline;
    expect(timeline).toEqual([
      { elapsedMs: 5_000, damage: 50, cumulativeDamage: 50, dps: 10 },
      { elapsedMs: 10_000, damage: 30, cumulativeDamage: 80, dps: 6 },
    ]);
  });

  test("resolves personal match by actor id, then by name", () => {
    // Same-displayName actors intentionally merge into one row (respawn continuity, see
    // getSnapshot's grouping step), so this meter can't produce an "ambiguous" personal match
    // the way FishNetDpsMeter's actor-directory-backed matching can.
    const meter = new TpsMeter();
    meter.consumeIdentity(identity(20, "Tank"));
    meter.consumeCombat(hit(20, 300, 10, 1), 1_000);

    const unconfigured = new TpsMeter().getSnapshot(window, 10_000);
    expect(unconfigured.personalMatch).toBe("unconfigured");

    meter.setPersonalActorId(20);
    expect(meter.getSnapshot(window, 10_000).personalMatch).toBe("matched");

    meter.setPersonalActorId(undefined);
    meter.setPersonalName(" tank ");
    expect(meter.getSnapshot(window, 10_000).personalMatch).toBe("matched");

    meter.setPersonalName("Nobody");
    expect(meter.getSnapshot(window, 10_000).personalMatch).toBe("missing");
  });

  test("reset clears buffered hits", () => {
    const meter = new TpsMeter();
    meter.consumeIdentity(identity(20, "Tank"));
    meter.consumeCombat(hit(20, 300, 50, 1), 1_000);
    meter.reset();

    expect(meter.getSnapshot(window, 10_000).actors).toHaveLength(0);
  });
});
