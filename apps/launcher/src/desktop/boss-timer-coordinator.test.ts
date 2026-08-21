import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { BOSS_ELIGIBLE_AFTER_MS, bossTimerKey } from "@svoverlay/contracts/boss-timers";

import { createBossTimerCoordinator, type BossTimerCoordinator } from "./boss-timer-coordinator.ts";

describe("boss timer coordinator", () => {
  test("a sighted gravestone starts one timer per boss per channel", async () => {
    const nowMs = 10_000_000;
    await withCoordinator({ now: () => nowMs }, async ({ coordinator }) => {
      coordinator.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", channel: 3, instanceId: "na3-12", diedAtMs: nowMs - 3_000 });
      coordinator.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", channel: 2, instanceId: "na3-12", diedAtMs: nowMs - 2_000 });
      coordinator.recordGravestone({ mobId: "Snake Naga", bossName: "Naga", instanceId: "na3-12", diedAtMs: nowMs - 1_000 });

      const { timers } = coordinator.getState();
      expect(timers).toHaveLength(3);
      expect(timers.map((timer) => timer.id)).toEqual([
        bossTimerKey("Wraith", "na", 3),
        bossTimerKey("Wraith", "na", 2),
        bossTimerKey("Snake Naga", "na", undefined),
      ]);
      expect(timers[0]).toMatchObject({
        bossName: "Wraith King",
        channel: 3,
        region: "na",
        instanceId: "na3-12",
        diedAtMs: nowMs - 3_000,
        source: "gravestone",
      });
      expect(timers[2]!.channel).toBeUndefined();
    });
  });

  test("separates the same boss and channel across regions, but not across machines", async () => {
    const nowMs = 10_000_000;
    await withCoordinator({ now: () => nowMs }, async ({ coordinator }) => {
      coordinator.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", channel: 3, instanceId: "na3-12", diedAtMs: nowMs - 60_000 });
      // Same boss and channel, different region: a separate rotation, so a separate timer.
      coordinator.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", channel: 3, instanceId: "eu2-6", diedAtMs: nowMs - 30_000 });
      // A different root inside the same region is the same rotation, so this re-anchors NA rather
      // than opening a third timer — the machine is recorded but is not part of the identity.
      coordinator.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", channel: 3, instanceId: "na4-7", diedAtMs: nowMs });

      const { timers } = coordinator.getState();
      expect(timers).toHaveLength(2);
      expect(timers.map((timer) => ({ region: timer.region, instanceId: timer.instanceId, diedAtMs: timer.diedAtMs }))).toEqual([
        { region: "eu", instanceId: "eu2-6", diedAtMs: nowMs - 30_000 },
        { region: "na", instanceId: "na4-7", diedAtMs: nowMs },
      ]);
    });
  });

  test("a repeat sighting re-anchors the existing timer", async () => {
    const nowMs = 10_000_000;
    await withCoordinator({ now: () => nowMs }, async ({ coordinator }) => {
      coordinator.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", channel: 3, diedAtMs: nowMs - 90 * 60_000 });
      coordinator.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", channel: 3, diedAtMs: nowMs });

      const { timers } = coordinator.getState();
      expect(timers).toHaveLength(1);
      expect(timers[0]).toMatchObject({ diedAtMs: nowMs, source: "gravestone" });
    });
  });

  test("re-anchors on a second death even well inside the respawn hour", async () => {
    const nowMs = 10_000_000;
    await withCoordinator({ now: () => nowMs }, async ({ coordinator }) => {
      // Killing a boss spawned from a summoning item overwrites the natural timer, so a death only
      // minutes after the last one is real data rather than an impossible repeat.
      coordinator.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", channel: 3, diedAtMs: nowMs - 4 * 60_000 });
      coordinator.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", channel: 3, diedAtMs: nowMs });

      const { timers } = coordinator.getState();
      expect(timers).toHaveLength(1);
      // The later kill wins: waiting from it is right, and a stale timer would fire early.
      expect(timers[0]!.diedAtMs).toBe(nowMs);
    });
  });

  test("a manual gravestone overrides a timer already running", async () => {
    const nowMs = 10_000_000;
    await withCoordinator({ now: () => nowMs }, async ({ coordinator }) => {
      coordinator.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", channel: 3, instanceId: "na3-12", diedAtMs: nowMs - 10 * 60_000 });
      const timer = coordinator.addManualTimer({ mobId: "Wraith", channel: 3, region: "na3-12", diedAtMs: nowMs });

      expect(timer?.diedAtMs).toBe(nowMs);
      expect(coordinator.getState().timers).toHaveLength(1);
      expect(coordinator.getState().timers[0]).toMatchObject({ diedAtMs: nowMs, source: "manual" });
    });
  });

  test("a manual gravestone entry backdates the timer by the recorded time of death", async () => {
    // Died 20 minutes ago: the timer must have 40 of its 60 minutes left, i.e. the reset rule
    // "60 minutes less the difference between now and the recorded time of death".
    const nowMs = 10_000_000;
    const diedAtMs = nowMs - 20 * 60_000;
    await withCoordinator({ now: () => nowMs }, async ({ coordinator }) => {
      coordinator.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", channel: 3, diedAtMs: nowMs - 55 * 60_000 });
      const timer = coordinator.addManualTimer({ mobId: "Wraith", channel: 3, diedAtMs });

      expect(timer).toMatchObject({ bossName: "Wraith King", channel: 3, diedAtMs, source: "manual" });
      const { timers } = coordinator.getState();
      expect(timers).toHaveLength(1);
      expect(timers[0]!.diedAtMs + BOSS_ELIGIBLE_AFTER_MS - nowMs).toBe(40 * 60_000);
    });
  });

  test("ignores a boss killed outside the world-boss channels", async () => {
    const nowMs = 10_000_000;
    await withCoordinator({ now: () => nowMs }, async ({ coordinator }) => {
      // Same catalog boss, dying the same way, but summoned by a player on a high channel.
      coordinator.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", channel: 7, diedAtMs: nowMs });
      coordinator.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", channel: 4, diedAtMs: nowMs });
      expect(coordinator.getState().timers).toHaveLength(0);

      coordinator.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", channel: 3, diedAtMs: nowMs });
      expect(coordinator.getState().timers).toHaveLength(1);
    });
  });

  test("a summoned-boss kill never re-anchors a real timer", async () => {
    const nowMs = 10_000_000;
    await withCoordinator({ now: () => nowMs }, async ({ coordinator }) => {
      coordinator.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", channel: 3, diedAtMs: nowMs - 30 * 60_000 });
      coordinator.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", channel: 7, diedAtMs: nowMs });

      const { timers } = coordinator.getState();
      expect(timers).toHaveLength(1);
      expect(timers[0]).toMatchObject({ channel: 3, diedAtMs: nowMs - 30 * 60_000 });
    });
  });

  test("manual entries reject channels no world boss spawns on", async () => {
    const nowMs = 10_000_000;
    await withCoordinator({ now: () => nowMs }, async ({ coordinator }) => {
      expect(coordinator.addManualTimer({ mobId: "Wraith", channel: 4, diedAtMs: nowMs })).toBeUndefined();
      expect(coordinator.addManualTimer({ mobId: "Wraith", channel: 0, diedAtMs: nowMs })).toBeUndefined();
      expect(coordinator.getState().timers).toHaveLength(0);

      expect(coordinator.addManualTimer({ mobId: "Wraith", channel: 3, diedAtMs: nowMs })).toBeDefined();
    });
  });

  test("drops persisted timers whose channel predates the world-boss rule", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-boss-timers-channel-"));
    const storagePath = path.join(directory, "boss-timers.json");
    try {
      const diedAtMs = Date.now();
      await writeFile(storagePath, JSON.stringify({
        cacheVersion: 1,
        timers: [
          { id: "Wraith 7", mobId: "Wraith", bossName: "Wraith King", channel: 7, diedAtMs, source: "gravestone" },
          { id: "Snake Naga 2", mobId: "Snake Naga", bossName: "Naga", channel: 2, diedAtMs, source: "gravestone" },
        ],
      }), "utf8");

      const coordinator = await createBossTimerCoordinator({ storagePath });
      const { timers } = coordinator.getState();
      expect(timers.map((timer) => timer.bossName)).toEqual(["Naga"]);
      await coordinator.shutdown();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("manual entries reject unknown bosses and clamp future death times", async () => {
    const nowMs = 10_000_000;
    await withCoordinator({ now: () => nowMs }, async ({ coordinator }) => {
      expect(coordinator.addManualTimer({ mobId: "NotABoss", channel: 1, diedAtMs: nowMs })).toBeUndefined();
      expect(coordinator.getState().timers).toHaveLength(0);

      const timer = coordinator.addManualTimer({ mobId: "Wraith", channel: 1, diedAtMs: nowMs + 60_000 });
      expect(timer?.diedAtMs).toBe(nowMs);
    });
  });

  test("expired timers linger for a while and are then dropped", async () => {
    let nowMs = 10_000_000;
    await withCoordinator({ now: () => nowMs }, async ({ coordinator }) => {
      coordinator.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", channel: 3, diedAtMs: nowMs });

      // 100 minutes later: expired (past 90) but still lingering on screen.
      nowMs += 100 * 60_000;
      coordinator.recordGravestone({ mobId: "Snake Naga", bossName: "Naga", channel: 3, diedAtMs: nowMs });
      expect(coordinator.getState().timers).toHaveLength(2);

      // 110 minutes: past the 105-minute removal point, so the next change sweeps it away.
      nowMs += 10 * 60_000;
      coordinator.recordGravestone({ mobId: "Hare", bossName: "Vorpal Hare", channel: 3, diedAtMs: nowMs });
      const { timers } = coordinator.getState();
      expect(timers.map((timer) => timer.bossName)).toEqual(["Naga", "Vorpal Hare"]);
    });
  });

  test("timers survive a restart through the storage file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-boss-timers-"));
    const storagePath = path.join(directory, "boss-timers.json");
    try {
      const first = await createBossTimerCoordinator({ storagePath });
      first.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", channel: 3, diedAtMs: Date.now() });
      await first.shutdown();

      const persisted = JSON.parse(await readFile(storagePath, "utf8")) as { timers: unknown[] };
      expect(persisted.timers).toHaveLength(1);

      const second = await createBossTimerCoordinator({ storagePath });
      expect(second.getState().timers).toHaveLength(1);
      expect(second.getState().timers[0]).toMatchObject({ bossName: "Wraith King", channel: 3 });
      await second.shutdown();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("stale persisted timers are pruned at load", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-boss-timers-stale-"));
    const storagePath = path.join(directory, "boss-timers.json");
    try {
      const first = await createBossTimerCoordinator({ storagePath });
      first.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", channel: 3, diedAtMs: Date.now() });
      await first.shutdown();

      const second = await createBossTimerCoordinator({
        storagePath,
        now: () => Date.now() + 106 * 60_000,
      });
      expect(second.getState().timers).toHaveLength(0);
      await second.shutdown();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("lists the catalog bosses for the manual picker in level order", async () => {
    await withCoordinator(async ({ coordinator }) => {
      const bosses = coordinator.bossOptions();
      expect(bosses.length).toBeGreaterThan(20);
      expect(bosses.some((boss) => boss.displayName === "Wraith King")).toBe(true);
      const levels = bosses.map((boss) => boss.level);
      expect(levels).toEqual([...levels].sort((left, right) => left - right));
    });
  });

  test("keeps the newer death when stored timers fold onto one region", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-boss-timers-fold-"));
    const storagePath = path.join(directory, "boss-timers.json");
    try {
      // Written before NA's second server family was folded in, so the same rotation is stored
      // twice under `sun` and `na`. Both normalize onto `na`, and file order says nothing about
      // which death came first — taking the older one would call the boss spawnable 40 minutes early.
      const diedAtMs = Date.now() - 10 * 60_000;
      await writeFile(storagePath, JSON.stringify({
        cacheVersion: 1,
        timers: [
          { id: "a", mobId: "Wraith", bossName: "Wraith King", region: "na", channel: 1, diedAtMs, source: "gravestone" },
          { id: "b", mobId: "Wraith", bossName: "Wraith King", region: "sun", channel: 1, diedAtMs: diedAtMs - 40 * 60_000, source: "gravestone" },
        ],
      }), "utf8");

      const coordinator = await createBossTimerCoordinator({ storagePath });
      const { timers } = coordinator.getState();
      expect(timers).toHaveLength(1);
      expect(timers[0]).toMatchObject({ id: bossTimerKey("Wraith", "na", 1), region: "na", diedAtMs });
      await coordinator.shutdown();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("a located sighting replaces the placeholder left by an unlocated one", async () => {
    const nowMs = 10_000_000;
    await withCoordinator({ now: () => nowMs }, async ({ coordinator }) => {
      // The same gravestone twice: once in the seconds before the channel list arrived, then again
      // once capture knew where we were. One death, so one timer — the corrected one.
      const diedAtMs = nowMs - 5 * 60_000;
      coordinator.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", diedAtMs });
      expect(coordinator.getState().timers).toHaveLength(1);

      coordinator.recordGravestone({
        mobId: "Wraith",
        bossName: "Wraith King",
        channel: 2,
        instanceId: "na3-12",
        diedAtMs,
      });
      const { timers } = coordinator.getState();
      expect(timers).toHaveLength(1);
      expect(timers[0]).toMatchObject({ id: bossTimerKey("Wraith", "na", 2), region: "na", channel: 2 });
    });
  });

  test("ignores a placeless sighting of a death already filed under a channel", async () => {
    const nowMs = 10_000_000;
    await withCoordinator({ now: () => nowMs }, async ({ coordinator }) => {
      // Reconnecting respawns nearby markers before the channel list lands, so a gravestone already
      // filed correctly is seen again with nothing to place it by. It must not raise a second,
      // placeless timer beside the one that already has the answer.
      const diedAtMs = nowMs - 5 * 60_000;
      coordinator.recordGravestone({
        mobId: "Wraith",
        bossName: "Wraith King",
        channel: 2,
        instanceId: "na3-12",
        diedAtMs,
      });
      coordinator.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", diedAtMs });

      const { timers } = coordinator.getState();
      expect(timers).toHaveLength(1);
      expect(timers[0]).toMatchObject({ id: bossTimerKey("Wraith", "na", 2), channel: 2 });
    });
  });

  test("keeps an unlocated timer that records a different death", async () => {
    const nowMs = 10_000_000;
    await withCoordinator({ now: () => nowMs }, async ({ coordinator }) => {
      // Same boss, different times of death: two real rotations, one of which we could not place.
      coordinator.recordGravestone({ mobId: "Wraith", bossName: "Wraith King", diedAtMs: nowMs - 20 * 60_000 });
      coordinator.recordGravestone({
        mobId: "Wraith",
        bossName: "Wraith King",
        channel: 2,
        instanceId: "na3-12",
        diedAtMs: nowMs - 5 * 60_000,
      });
      expect(coordinator.getState().timers).toHaveLength(2);
    });
  });

  test("follows the player's region for the overlay tab and the manual entry default", async () => {
    await withCoordinator(async ({ coordinator }) => {
      expect(coordinator.getState().currentRegion).toBeUndefined();
      expect(coordinator.currentInstanceId()).toBeUndefined();

      let notified = 0;
      const unsubscribe = coordinator.subscribe(() => { notified += 1; });
      coordinator.setCurrentInstance("sun1-4");
      expect(coordinator.getState().currentRegion).toBe("na");
      expect(coordinator.currentInstanceId()).toBe("sun1-4");
      expect(notified).toBe(1);

      // Nothing moved, so nothing is announced; the same reading arrives on every channel list.
      coordinator.setCurrentInstance("sun1-4");
      expect(notified).toBe(1);

      coordinator.setCurrentInstance(undefined);
      expect(coordinator.getState().currentRegion).toBeUndefined();
      expect(notified).toBe(2);
      unsubscribe();
    });
  });

  test("publishes the character being played, so own kills can be marked", async () => {
    await withCoordinator(async ({ coordinator }) => {
      expect(coordinator.getState().playerName).toBeUndefined();

      let notified = 0;
      const unsubscribe = coordinator.subscribe(() => { notified += 1; });
      coordinator.setPlayerName("Nabooru");
      expect(coordinator.getState().playerName).toBe("Nabooru");
      expect(notified).toBe(1);

      // Character state republishes constantly; only an actual change is worth announcing.
      coordinator.setPlayerName("Nabooru");
      expect(notified).toBe(1);

      // Blank is the same as unknown, so a snapshot without a name does not mark every timer.
      coordinator.setPlayerName("   ");
      expect(coordinator.getState().playerName).toBeUndefined();
      expect(notified).toBe(2);
      unsubscribe();
    });
  });

  test("removing a timer notifies subscribers", async () => {
    await withCoordinator(async ({ coordinator }) => {
      coordinator.recordGravestone({
        mobId: "Wraith",
        bossName: "Wraith King",
        channel: 3,
        instanceId: "na3-12",
        diedAtMs: Date.now(),
      });
      let notified = 0;
      const unsubscribe = coordinator.subscribe(() => { notified += 1; });
      coordinator.removeTimer(bossTimerKey("Wraith", "na", 3));
      unsubscribe();
      expect(notified).toBe(1);
      expect(coordinator.getState().timers).toHaveLength(0);
    });
  });
});

async function withCoordinator(
  run: (context: { coordinator: BossTimerCoordinator }) => Promise<void>,
): Promise<void>;
async function withCoordinator(
  options: { now?: () => number },
  run: (context: { coordinator: BossTimerCoordinator }) => Promise<void>,
): Promise<void>;
async function withCoordinator(
  optionsOrRun:
    | { now?: () => number }
    | ((context: { coordinator: BossTimerCoordinator }) => Promise<void>),
  maybeRun?: (context: { coordinator: BossTimerCoordinator }) => Promise<void>,
): Promise<void> {
  const run = typeof optionsOrRun === "function" ? optionsOrRun : maybeRun!;
  const options = typeof optionsOrRun === "function" ? {} : optionsOrRun;
  const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-boss-timer-coordinator-"));
  try {
    const coordinator = await createBossTimerCoordinator({
      storagePath: path.join(directory, "boss-timers.json"),
      ...options,
    });
    try {
      await run({ coordinator });
    } finally {
      await coordinator.shutdown();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
