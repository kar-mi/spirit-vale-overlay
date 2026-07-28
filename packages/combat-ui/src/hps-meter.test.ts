import { describe, expect, test } from "bun:test";
import type { FishNetActorIdentityEvent, FishNetCombatHealEvent, FishNetHealAttribution } from "@kar-mi/spirit-vale-tools-combat";

import { HpsMeter } from "./hps-meter.ts";

function identity(actorId: number, displayName: string): FishNetActorIdentityEvent {
  return { kind: "actorIdentity", operation: "upsert", tick: 1, actorId, displayName };
}

function heal(
  targetId: number,
  value: number,
  attribution: FishNetHealAttribution,
  actorId?: number,
  sourceId?: string,
): FishNetCombatHealEvent {
  return {
    kind: "heal",
    rpc: "Recover_C",
    tick: 1,
    payloadBytes: 0,
    fields: {},
    targetId,
    actorId,
    sourceId,
    sourceLabel: sourceId,
    value,
    attribution,
  };
}

const window = { id: "enc-1", startedAtMs: 0, endedAtMs: 10_000, durationMs: 10_000 };

describe("HpsMeter", () => {
  test("groups healing by the identified healer, not the recipient", () => {
    const meter = new HpsMeter();
    meter.consumeIdentity(identity(10, "Healer"));
    meter.consumeCombat(heal(20, 100, "exact", 10, "Heal"), 1_000);
    meter.consumeCombat(heal(20, 50, "exact", 10, "Heal"), 2_000);

    const snapshot = meter.getSnapshot(window, 10_000);
    expect(snapshot.actors).toHaveLength(1);
    expect(snapshot.actors[0]).toMatchObject({ displayName: "Healer", damage: 150, hits: 2, mobsHit: 1 });
  });

  test("credits heals cast on other players to the healer, not the recipient", () => {
    const meter = new HpsMeter();
    meter.consumeIdentity(identity(10, "Healer"));
    meter.consumeIdentity(identity(20, "Tank"));
    meter.consumeCombat(heal(10, 40, "exact", 10, "Heal"), 1_000); // self-heal
    meter.consumeCombat(heal(20, 60, "exact", 10, "Heal"), 2_000); // heals someone else

    const snapshot = meter.getSnapshot(window, 10_000);
    expect(snapshot.actors).toHaveLength(1);
    expect(snapshot.actors[0]).toMatchObject({ displayName: "Healer", damage: 100, hits: 2, mobsHit: 2 });
  });

  test("credits unattributed heals (regen, leech) to the recipient as self-healing", () => {
    const meter = new HpsMeter();
    meter.consumeIdentity(identity(20, "Tank"));
    meter.consumeCombat(heal(20, 40, "unattributed"), 1_000);
    meter.consumeCombat(heal(20, 30, "ambiguous"), 2_000);
    meter.consumeCombat(heal(20, 60, "exact", 20, "Heal"), 3_000); // self-cast heal, same actor

    const snapshot = meter.getSnapshot(window, 10_000);
    expect(snapshot.actors).toHaveLength(1);
    expect(snapshot.actors[0]).toMatchObject({ displayName: "Tank", damage: 130, hits: 3 });
  });

  test("drops unattributed heals whose recipient isn't a known party member", () => {
    const meter = new HpsMeter();
    meter.consumeCombat(heal(999, 100, "unattributed"), 1_000);

    const snapshot = meter.getSnapshot(window, 10_000);
    expect(snapshot.actors).toHaveLength(0);
  });

  test("drops heals from a healer with no known identity", () => {
    const meter = new HpsMeter();
    meter.consumeCombat(heal(20, 100, "exact", 999, "Heal"), 1_000);

    const snapshot = meter.getSnapshot(window, 10_000);
    expect(snapshot.actors).toHaveLength(0);
  });

  test("groups a healer's output by skill", () => {
    const meter = new HpsMeter();
    meter.consumeIdentity(identity(10, "Healer"));
    meter.consumeCombat(heal(20, 60, "exact", 10, "Heal"), 1_000);
    meter.consumeCombat(heal(21, 40, "exact", 10, "HealAll"), 2_000);

    const skills = meter.getSnapshot(window, 10_000).actors[0]!.skills;
    expect(skills.find((skill) => skill.sourceId === "Heal")).toMatchObject({ damage: 60, hits: 1 });
    expect(skills.find((skill) => skill.sourceId === "HealAll")).toMatchObject({ damage: 40, hits: 1 });
  });

  test("skips non-positive heal values", () => {
    const meter = new HpsMeter();
    meter.consumeIdentity(identity(10, "Healer"));
    meter.consumeCombat(heal(20, 0, "exact", 10, "Heal"), 1_000);

    expect(meter.getSnapshot(window, 10_000).actors).toHaveLength(0);
  });

  test("resolves personal match the same way as TPS", () => {
    const meter = new HpsMeter();
    meter.consumeIdentity(identity(10, "Healer"));
    meter.consumeCombat(heal(20, 40, "exact", 10, "Heal"), 1_000);

    meter.setPersonalActorId(10);
    expect(meter.getSnapshot(window, 10_000).personalMatch).toBe("matched");
  });

  test("reset clears buffered hits", () => {
    const meter = new HpsMeter();
    meter.consumeIdentity(identity(10, "Healer"));
    meter.consumeCombat(heal(20, 40, "exact", 10, "Heal"), 1_000);
    meter.reset();

    expect(meter.getSnapshot(window, 10_000).actors).toHaveLength(0);
  });
});
