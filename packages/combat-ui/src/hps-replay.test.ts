import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { FishNetDpsEncounterSnapshot } from "@kar-mi/spirit-vale-tools-combat";

import { loadHpsReplay } from "./hps-replay.ts";

describe("hps replay", () => {
  test("groups healing by the identified healer, including heals cast on others", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-hps-replay-"));
    const logPath = path.join(directory, "combat.jsonl");
    try {
      await writeFile(logPath, [
        record("combat.actorIdentity", { kind: "actorIdentity", operation: "upsert", tick: 1, actorId: 10, displayName: "Healbot" }, 0),
        record("combat.event", heal(2, 10, 100, 10, "Heal"), 1_000), // self-heal
        record("combat.event", heal(3, 21, 40, 10, "Heal"), 2_000), // heals someone else
      ].join("\n"));

      const snapshot = makeSnapshot("enc-1", 0, 10_000);
      const replay = await loadHpsReplay(logPath, [snapshot]);
      expect(replay.invalidLines).toBe(0);
      const actors = replay.snapshots[0]!.actors;
      expect(actors).toHaveLength(1);
      expect(actors[0]).toMatchObject({ displayName: "Healbot", damage: 140, hits: 2, mobsHit: 2 });
      const skills = actors[0]!.skills;
      expect(skills.find((skill) => skill.sourceId === "Heal")).toMatchObject({ damage: 140 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("drops heals with no identified healer and no known recipient", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-hps-replay-"));
    const logPath = path.join(directory, "combat.jsonl");
    try {
      await writeFile(logPath, [
        record("combat.event", heal(1, 999, 50), 1_000),
      ].join("\n"));

      const snapshot = makeSnapshot("enc-1", 0, 10_000);
      const replay = await loadHpsReplay(logPath, [snapshot]);
      expect(replay.snapshots[0]!.actors).toHaveLength(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("credits unattributed heals (regen, leech) to a known recipient as self-healing", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-hps-replay-"));
    const logPath = path.join(directory, "combat.jsonl");
    try {
      await writeFile(logPath, [
        record("combat.actorIdentity", { kind: "actorIdentity", operation: "upsert", tick: 1, actorId: 20, displayName: "Tank" }, 0),
        record("combat.event", heal(1, 20, 40), 1_000), // no actorId -> unattributed regen/leech
      ].join("\n"));

      const snapshot = makeSnapshot("enc-1", 0, 10_000);
      const replay = await loadHpsReplay(logPath, [snapshot]);
      const actors = replay.snapshots[0]!.actors;
      expect(actors).toHaveLength(1);
      expect(actors[0]).toMatchObject({ displayName: "Tank", damage: 40, hits: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("keeps actor-less healing when the recipient identity is removed after the encounter", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-hps-replay-"));
    const logPath = path.join(directory, "combat.jsonl");
    try {
      await writeFile(logPath, [
        record("combat.actorIdentity", { kind: "actorIdentity", operation: "upsert", tick: 1, actorId: 20, displayName: "Tank" }, 0),
        record("combat.event", heal(2, 20, 40), 1_000),
        record("combat.actorIdentity", { kind: "actorIdentity", operation: "remove", tick: 4, actorId: 20 }, 3_000),
      ].join("\n"));

      const snapshot = makeSnapshot("enc-1", 0, 10_000, 2_000);
      const replay = await loadHpsReplay(logPath, [snapshot]);
      expect(replay.snapshots[0]!.actors).toMatchObject([{ displayName: "Tank", damage: 40, hits: 1 }]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("merges healing across respawned actor ids with the same normalized name", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-hps-replay-"));
    const logPath = path.join(directory, "combat.jsonl");
    try {
      await writeFile(logPath, [
        record("combat.actorIdentity", { kind: "actorIdentity", operation: "upsert", tick: 1, actorId: 10, displayName: "Ember Sage" }, 0),
        record("combat.event", heal(2, 10, 47_518), 1_000),
        record("combat.actorIdentity", { kind: "actorIdentity", operation: "reset", tick: 3 }, 2_000),
        record("combat.actorIdentity", { kind: "actorIdentity", operation: "upsert", tick: 4, actorId: 20, displayName: " ember sage " }, 3_000),
        record("combat.event", heal(5, 20, 345_693), 4_000),
      ].join("\n"));

      const snapshot = makeSnapshot("enc-1", 0, 10_000);
      const replay = await loadHpsReplay(logPath, [snapshot]);
      expect(replay.invalidLines).toBe(0);
      expect(replay.snapshots[0]!.actors).toMatchObject([{
        actorIds: [10, 20],
        displayName: "Ember Sage",
        damage: 393_211,
        hits: 2,
      }]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

});

function makeSnapshot(id: string, startedAtMs: number, endedAtMs: number, lastDamageAtMs = endedAtMs): FishNetDpsEncounterSnapshot {
  return {
    id,
    startedAtMs,
    lastDamageAtMs,
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

function heal(tick: number, targetId: number, value: number, actorId?: number, sourceId?: string): Record<string, unknown> {
  return { kind: "heal", tick, targetId, value, actorId, sourceId, sourceLabel: sourceId };
}
