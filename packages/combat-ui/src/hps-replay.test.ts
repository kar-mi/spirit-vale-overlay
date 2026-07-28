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

  test("drops heals with no identified healer", async () => {
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

function heal(tick: number, targetId: number, value: number, actorId?: number, sourceId?: string): Record<string, unknown> {
  return { kind: "heal", tick, targetId, value, actorId, sourceId, sourceLabel: sourceId };
}
