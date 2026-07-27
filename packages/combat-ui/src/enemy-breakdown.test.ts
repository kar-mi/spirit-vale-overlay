import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { FishNetDpsEncounterSnapshot } from "@kar-mi/spirit-vale-tools-combat";

import { loadEnemyBreakdown } from "./enemy-breakdown.ts";

describe("enemy breakdown replay", () => {
  test("numbers duplicate mob names in first-seen order", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-enemy-breakdown-"));
    const logPath = path.join(directory, "combat.jsonl");
    try {
      await writeFile(logPath, [
        record("combat.event", { kind: "activation", tick: 1, actorId: 200, sourceId: "__spiritvaleMobIdentity:Orc", sourceLabel: "Orc", level: 10 }, 0),
        record("combat.event", { kind: "activation", tick: 1, actorId: 201, sourceId: "__spiritvaleMobIdentity:Orc", sourceLabel: "Orc", level: 10 }, 0),
        record("combat.event", { kind: "activation", tick: 1, actorId: 300, sourceId: "__spiritvaleMobIdentity:Kraken", sourceLabel: "Kraken", level: 40 }, 0),
        record("combat.event", damage(2, 10, 201, 50, "Slash"), 1_000),
        record("combat.event", damage(3, 10, 200, 40, "Slash"), 2_000),
        record("combat.event", damage(4, 10, 300, 80, "Slash"), 3_000),
      ].join("\n"));

      const snapshot = makeSnapshot("enc-1", 0, 10_000);
      const replay = await loadEnemyBreakdown(logPath, [snapshot]);
      expect(replay.invalidLines).toBe(0);
      expect(replay.encounters).toHaveLength(1);
      const enemies = replay.encounters[0]!.enemies;
      expect(enemies.map((enemy) => enemy.label)).toEqual(["Orc (1)", "Orc (2)", "Kraken"]);
      expect(enemies.find((enemy) => enemy.targetId === 201)?.label).toBe("Orc (1)");
      expect(enemies.find((enemy) => enemy.targetId === 200)?.label).toBe("Orc (2)");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("folds damage and hits per actor, target, and skill", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-enemy-breakdown-"));
    const logPath = path.join(directory, "combat.jsonl");
    try {
      await writeFile(logPath, [
        record("combat.event", { kind: "activation", tick: 1, actorId: 300, sourceId: "__spiritvaleMobIdentity:Kraken", sourceLabel: "Kraken", level: 40 }, 0),
        record("combat.event", damage(2, 10, 300, 40, "Slash"), 1_000),
        record("combat.event", damage(3, 10, 300, 60, "Slash", "critical"), 2_000),
        record("combat.event", damage(4, 10, 300, 25, "Fireball"), 3_000),
      ].join("\n"));

      const snapshot = makeSnapshot("enc-1", 0, 10_000);
      const replay = await loadEnemyBreakdown(logPath, [snapshot]);
      const bySkill = replay.encounters[0]!.bySkill.get(10)?.get(300);
      expect(bySkill?.get("Slash")).toMatchObject({ damage: 100, hits: 2, criticalHits: 1 });
      expect(bySkill?.get("Fireball")).toMatchObject({ damage: 25, hits: 1, criticalHits: 0 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("buckets hits into the encounter snapshot whose time window contains them", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-enemy-breakdown-"));
    const logPath = path.join(directory, "combat.jsonl");
    try {
      await writeFile(logPath, [
        record("combat.event", { kind: "activation", tick: 1, actorId: 300, sourceId: "__spiritvaleMobIdentity:Kraken", sourceLabel: "Kraken", level: 40 }, 0),
        record("combat.event", damage(2, 10, 300, 40, "Slash"), 1_000),
        record("combat.event", damage(3, 10, 300, 60, "Slash"), 20_000),
      ].join("\n"));

      const first = makeSnapshot("enc-1", 0, 5_000);
      const second = makeSnapshot("enc-2", 15_000, 25_000);
      const replay = await loadEnemyBreakdown(logPath, [first, second]);

      const firstDamage = replay.encounters.find((encounter) => encounter.encounterId === "enc-1")!.bySkill.get(10)?.get(300)?.get("Slash");
      const secondDamage = replay.encounters.find((encounter) => encounter.encounterId === "enc-2")!.bySkill.get(10)?.get(300)?.get("Slash");
      expect(firstDamage).toMatchObject({ damage: 40, hits: 1 });
      expect(secondDamage).toMatchObject({ damage: 60, hits: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("anchors elapsed time at the first parsed event, not the first damage event", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-enemy-breakdown-"));
    const logPath = path.join(directory, "combat.jsonl");
    try {
      await writeFile(logPath, [
        // A non-mob-identity activation precedes the first damage event; it must set the time origin.
        record("combat.event", { kind: "activation", tick: 1, actorId: 10, actionKind: "skill", phase: "begin", sourceId: "Slash", sourceLabel: "Slash" }, 0),
        record("combat.event", { kind: "activation", tick: 1, actorId: 300, sourceId: "__spiritvaleMobIdentity:Kraken", sourceLabel: "Kraken", level: 40 }, 0),
        record("combat.event", damage(2, 10, 300, 40, "Slash"), 5_000),
        record("combat.event", damage(3, 10, 300, 60, "Slash"), 9_000),
      ].join("\n"));

      const snapshot = makeSnapshot("enc-1", 4_000, 10_000);
      const replay = await loadEnemyBreakdown(logPath, [snapshot]);
      const slash = replay.encounters[0]!.bySkill.get(10)?.get(300)?.get("Slash");
      expect(slash).toMatchObject({ damage: 100, hits: 2 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function makeSnapshot(id: string, startedAtMs: number, endedAtMs: number): FishNetDpsEncounterSnapshot {
  return {
    id,
    startedAtMs,
    lastDamageAtMs: endedAtMs,
    endedAtMs,
    durationMs: endedAtMs - startedAtMs,
    totalDamage: 0,
    partyDps: 0,
    partyCurrentDps: 0,
    actors: [],
    personalName: "",
    personalMatch: "unconfigured",
  };
}

function record(type: string, data: Record<string, unknown>, elapsedMs: number): string {
  return JSON.stringify({ schemaVersion: 1, sessionId: "test", sequence: elapsedMs + 1, recordedAt: new Date(Date.UTC(2026, 0, 1) + elapsedMs).toISOString(), source: "desktop-capture", type, data });
}

function damage(tick: number, actorId: number, targetId: number, value: number, sourceLabel: string, hitResult: "normal" | "critical" = "normal"): Record<string, unknown> {
  return { kind: "damage", tick, actorId, targetId, value, team: 1, sourceId: sourceLabel, sourceLabel, hitResult };
}
