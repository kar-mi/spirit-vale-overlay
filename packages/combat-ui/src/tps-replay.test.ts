import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { FishNetDpsEncounterSnapshot } from "@kar-mi/spirit-vale-tools-combat";

import { loadTpsReplay } from "./tps-replay.ts";

describe("tps replay", () => {
  test("groups only non-zero-team hits by the victim, ignoring the party's own outgoing damage", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-tps-replay-"));
    const logPath = path.join(directory, "combat.jsonl");
    try {
      await writeFile(logPath, [
        record("combat.actorIdentity", { kind: "actorIdentity", operation: "upsert", tick: 1, actorId: 10, displayName: "Tank" }, 0),
        // Party member (10) hits a mob (300) — team 0, must be excluded from tanked totals.
        record("combat.event", damage(2, 10, 300, 50, 0), 1_000),
        // Mob (300) hits the party member (10) — non-zero team, this is the tanked hit.
        record("combat.event", damage(3, 300, 10, 40, 1), 2_000),
      ].join("\n"));

      const snapshot = makeSnapshot("enc-1", 0, 10_000);
      const replay = await loadTpsReplay(logPath, [snapshot]);
      expect(replay.invalidLines).toBe(0);
      const actors = replay.snapshots[0]!.actors;
      expect(actors).toHaveLength(1);
      expect(actors[0]).toMatchObject({ displayName: "Tank", damage: 40, hits: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("scopes hits to the matching encounter window", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-tps-replay-"));
    const logPath = path.join(directory, "combat.jsonl");
    try {
      await writeFile(logPath, [
        record("combat.actorIdentity", { kind: "actorIdentity", operation: "upsert", tick: 1, actorId: 10, displayName: "Tank" }, 0),
        record("combat.event", damage(2, 300, 10, 40, 1), 1_000),
        record("combat.event", damage(3, 300, 10, 60, 1), 20_000),
      ].join("\n"));

      const first = makeSnapshot("enc-1", 0, 5_000);
      const second = makeSnapshot("enc-2", 15_000, 25_000);
      const replay = await loadTpsReplay(logPath, [first, second]);

      expect(replay.snapshots[0]!.actors[0]).toMatchObject({ damage: 40 });
      expect(replay.snapshots[1]!.actors[0]).toMatchObject({ damage: 60 });
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

function damage(tick: number, actorId: number, targetId: number, value: number, team: number): Record<string, unknown> {
  return { kind: "damage", tick, actorId, targetId, value, team, sourceId: "Cleave", sourceLabel: "Cleave", hitResult: "normal" };
}
