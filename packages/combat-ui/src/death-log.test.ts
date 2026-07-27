import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadDeathLogReplay } from "./death-log.ts";

describe("combat death log replay", () => {
  test("keeps the ten-second received-damage window and deduplicates the lethal hit", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-death-log-"));
    const logPath = path.join(directory, "combat.jsonl");
    try {
      await writeFile(logPath, [
        record("combat.actorIdentity", { kind: "actorIdentity", operation: "upsert", tick: 1, actorId: 10, displayName: "Fallen Hero" }, 0),
        record("combat.actorIdentity", { kind: "actorIdentity", operation: "upsert", tick: 1, actorId: 90, displayName: "Enemy Player" }, 0),
        record("combat.event", damage(2, 90, 10, 50, "Old Hit"), 999),
        record("combat.event", damage(3, 90, 10, 100, "Edge Hit"), 2_000),
        record("combat.event", damage(4, 90, 10, 200, "Critical Hit", "critical"), 11_000),
        record("combat.event", death(4, 90, 10, 200, "Critical Hit", true), 11_000),
      ].join("\n"));

      const replay = await loadDeathLogReplay(logPath);
      expect(replay.deaths).toHaveLength(1);
      expect(replay.deaths[0]).toMatchObject({ victimName: "Fallen Hero", totalDamage: 300 });
      expect(replay.deaths[0]?.hits.map((hit) => hit.sourceLabel)).toEqual(["Edge Hit", "Critical Hit"]);
      expect(replay.deaths[0]?.hits.at(-1)).toMatchObject({ attackerLabel: "Enemy Player", critical: true, beforeDeathMs: 0 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("shows an unresolved non-player-team death as unidentified", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-death-log-"));
    const logPath = path.join(directory, "combat.jsonl");
    try {
      await writeFile(logPath, record("combat.event", death(5, 4, 40, 25, "Unknown Strike", false), 2_000));
      const replay = await loadDeathLogReplay(logPath);
      expect(replay.deaths[0]).toMatchObject({ victimName: "Unidentified player", totalDamage: 25 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("uses the recorded monster identity for an incoming attacker", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-death-log-"));
    const logPath = path.join(directory, "combat.jsonl");
    try {
      await writeFile(logPath, [
        record("combat.event", { kind: "activation", tick: 1, actorId: 700, sourceId: "__spiritvaleMobIdentity:Abomination", sourceLabel: "Abomination", level: 60 }, 0),
        record("combat.event", death(2, 700, 40, 25, "Basic Attack", false), 2_000),
      ].join("\n"));
      const replay = await loadDeathLogReplay(logPath);
      expect(replay.deaths[0]?.hits[0]?.attackerLabel).toBe("Abomination");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function record(type: string, data: Record<string, unknown>, elapsedMs: number): string {
  return JSON.stringify({ schemaVersion: 1, sessionId: "test", sequence: elapsedMs + 1, recordedAt: new Date(Date.UTC(2026, 0, 1) + elapsedMs).toISOString(), source: "desktop-capture", type, data });
}

function damage(tick: number, actorId: number, targetId: number, value: number, sourceLabel: string, hitResult: "normal" | "critical" = "normal"): Record<string, unknown> {
  return { kind: "damage", tick, actorId, targetId, value, team: 1, sourceId: sourceLabel, sourceLabel, hitResult };
}

function death(tick: number, actorId: number, targetId: number, value: number, sourceLabel: string, duplicatesDamageEvent: boolean): Record<string, unknown> {
  return { kind: "death", tick, actorId, targetId, value, team: 1, sourceId: sourceLabel, sourceLabel, hitResult: "normal", duplicatesDamageEvent };
}
