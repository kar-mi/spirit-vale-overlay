import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createXpTrackerCoordinator } from "./xp-tracker-coordinator.ts";

let temporaryRoot: string | undefined;

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

describe("XP tracker coordinator", () => {
  test("tracks coins alongside XP from the rewards log", async () => {
    const root = await tempRoot();
    const sessionId = "s-gold";
    // Watermark is set to wall-clock "now" at startup; use future timestamps so every
    // synthetic kill counts.
    const t0 = Date.now() + 60_000;
    await writeRewardsSession(root, sessionId, [
      kill(1, 100, "500", t0),
      kill(2, 100, "1500", t0 + 5_000),
      kill(3, 100, "3000", t0 + 10_000),
    ]);

    const coordinator = createXpTrackerCoordinator({ logDirectory: root });
    await waitFor(() => coordinator.getCoinsSnapshot().total === 5000);

    const coins = coordinator.getCoinsSnapshot();
    expect(coins.total).toBe(5000);
    expect(coins.perHour).toBe(5000);
    expect(coins.perSecond).toBeGreaterThan(0);

    // XP is still tracked from the same records.
    expect(coordinator.getSnapshot().total).toBe(300);

    coordinator.shutdown();
  });

  test("resets coins independently of XP", async () => {
    const root = await tempRoot();
    const sessionId = "s-gold-reset";
    const t0 = Date.now() + 60_000;
    await writeRewardsSession(root, sessionId, [
      kill(1, 100, "500", t0),
      kill(2, 200, "2500", t0 + 5_000),
    ]);

    const coordinator = createXpTrackerCoordinator({ logDirectory: root });
    await waitFor(() => coordinator.getCoinsSnapshot().total === 3000);
    expect(coordinator.getCoinsSnapshot().total).toBe(3000);

    coordinator.resetCoins();
    expect(coordinator.getCoinsSnapshot().total).toBe(0);
    // XP total is untouched by a coins-only reset.
    expect(coordinator.getSnapshot().total).toBe(300);

    coordinator.shutdown();
  });

  test("ignores kills with no coins and malformed records", async () => {
    const root = await tempRoot();
    const sessionId = "s-gold-malformed";
    const t0 = Date.now() + 60_000;
    await writeRewardsSession(root, sessionId, [
      kill(1, 100, "0", t0),
      kill(2, 100, "750", t0 + 5_000),
      malformedKill(3, t0 + 10_000),
    ]);

    const coordinator = createXpTrackerCoordinator({ logDirectory: root });
    await waitFor(() => coordinator.getCoinsSnapshot().total === 750);

    expect(coordinator.getCoinsSnapshot().total).toBe(750);
    coordinator.shutdown();
  });
});

/** Pumps the coordinator's async first poll until `condition` holds, with a hard timeout. */
async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the coordinator to ingest the rewards log");
    await Bun.sleep(10);
  }
}

async function tempRoot(): Promise<string> {
  temporaryRoot ??= await mkdtemp(path.join(tmpdir(), "spiritvale-xp-coordinator-"));
  return temporaryRoot;
}

function kill(sequence: number, experience: number, coins: string, atMs: number): Record<string, unknown> {
  return {
    schemaVersion: 1,
    sessionId: "synthetic",
    sequence,
    recordedAt: new Date(atMs).toISOString(),
    source: "synthetic",
    type: "rewards.kill",
    data: {
      tick: sequence,
      kind: "kill",
      id: `kill-${sequence}`,
      mob: { objectId: 900, mobId: "mob_900", displayName: "Test Mob", level: 10, boss: false },
      experience,
      jobExperience: 0,
      coins,
      drops: [],
      attributed: true,
    },
  };
}

/** Same shape as a kill, but coins is not a decimal string — the tracker must skip it. */
function malformedKill(sequence: number, atMs: number): Record<string, unknown> {
  return {
    schemaVersion: 1,
    sessionId: "synthetic",
    sequence,
    recordedAt: new Date(atMs).toISOString(),
    source: "synthetic",
    type: "rewards.kill",
    data: {
      tick: sequence,
      kind: "kill",
      id: `kill-${sequence}`,
      mob: { objectId: 900, mobId: "mob_900", displayName: "Test Mob", level: 10, boss: false },
      experience: 100,
      jobExperience: 0,
      coins: "not-a-number",
      drops: [],
      attributed: true,
    },
  };
}

async function writeRewardsSession(root: string, sessionId: string, records: Array<Record<string, unknown>>): Promise<void> {
  const sessionDirectory = path.join(root, "sessions", sessionId);
  await mkdir(sessionDirectory, { recursive: true });
  await mkdir(path.join(root, "current"), { recursive: true });
  await writeFile(
    path.join(root, "current", "rewards.json"),
    JSON.stringify({
      schemaVersion: 1,
      stream: "rewards",
      sessionId,
      startedAt: new Date().toISOString(),
      relativePath: path.join("sessions", sessionId, "rewards.jsonl"),
    }),
    "utf8",
  );
  const lines = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(path.join(sessionDirectory, "rewards.jsonl"), `${lines}\n`, "utf8");
}
