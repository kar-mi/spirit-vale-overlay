import { describe, expect, test } from "bun:test";

import {
  BOSS_ELIGIBLE_AFTER_MS,
  BOSS_SPAWN_WINDOW_MS,
  BOSS_TIMER_EXPIRED_LINGER_MS,
  bossDueAtMs,
  bossEligibleAtMs,
  bossTimerKey,
  bossTimerPhase,
  bossTimerRemoveAtMs,
  bossRegionOf,
  bossRegionsPresent,
  compareBossRegions,
  isBossChannel,
  isOwnBossKill,
  nextBossRegion,
  resolveBossRegion,
  BOSS_REGIONS,
  UNKNOWN_BOSS_REGION,
  type BossTimer,
} from "./boss-timers.ts";

describe("boss timer contract", () => {
  const diedAtMs = 1_000_000;
  const timer = { diedAtMs };

  test("waits for the first hour, opens a 30-minute window, then expires", () => {
    expect(bossTimerPhase(timer, diedAtMs)).toBe("waiting");
    expect(bossTimerPhase(timer, diedAtMs + BOSS_ELIGIBLE_AFTER_MS - 1)).toBe("waiting");
    expect(bossTimerPhase(timer, diedAtMs + BOSS_ELIGIBLE_AFTER_MS)).toBe("window");
    expect(bossTimerPhase(timer, diedAtMs + BOSS_ELIGIBLE_AFTER_MS + BOSS_SPAWN_WINDOW_MS - 1)).toBe("window");
    expect(bossTimerPhase(timer, diedAtMs + BOSS_ELIGIBLE_AFTER_MS + BOSS_SPAWN_WINDOW_MS)).toBe("expired");
  });

  test("boundaries sit at 60 and 90 minutes after death", () => {
    expect(bossEligibleAtMs(timer) - diedAtMs).toBe(60 * 60_000);
    expect(bossDueAtMs(timer) - diedAtMs).toBe(90 * 60_000);
    expect(bossTimerRemoveAtMs(timer)).toBe(bossDueAtMs(timer) + BOSS_TIMER_EXPIRED_LINGER_MS);
  });

  test("accepts only the channels world bosses spawn on", () => {
    expect(isBossChannel(1)).toBe(true);
    expect(isBossChannel(3)).toBe(true);
    // Channel 4 and up carry summoned bosses, which respawn nothing.
    expect(isBossChannel(4)).toBe(false);
    expect(isBossChannel(7)).toBe(false);
    expect(isBossChannel(0)).toBe(false);
    expect(isBossChannel(-1)).toBe(false);
    expect(isBossChannel(2.5)).toBe(false);
    expect(isBossChannel(undefined)).toBe(false);
  });

  test("keys one timer per boss per region per channel, with unknowns apart", () => {
    expect(bossTimerKey("Wraith", "na", 3)).toBe(bossTimerKey("Wraith", "na", 3));
    expect(bossTimerKey("Wraith", "na", 3)).not.toBe(bossTimerKey("Wraith", "na", 4));
    expect(bossTimerKey("Wraith", "na", 3)).not.toBe(bossTimerKey("Wraith", "eu", 3));
    expect(bossTimerKey("Wraith", undefined, 3)).not.toBe(bossTimerKey("Wraith", "na", 3));
    expect(bossTimerKey("Wraith", "na", undefined)).not.toBe(bossTimerKey("Wraith", "na", 3));
    expect(bossTimerKey("Wraith", "na", 3)).not.toBe(bossTimerKey("Naga", "na", 3));
  });

  test("reads the region from a server instance id, ignoring the machine part", () => {
    // The machine can move between roots without the region changing, so only the letters count.
    expect(bossRegionOf("na3-12")).toBe("na");
    expect(bossRegionOf("na4-7")).toBe("na");
    expect(bossRegionOf("eu2-6")).toBe("eu");
    expect(bossRegionOf("jp2-2")).toBe("jp");
    expect(bossRegionOf(undefined)).toBeUndefined();
    expect(bossRegionOf("  ")).toBeUndefined();
  });

  test("folds a region's second server family onto the one region", () => {
    // Hunting NA would otherwise split across two lists that never reconcile.
    expect(bossRegionOf("sun1-4")).toBe("na");
    expect(bossRegionOf("SUN1-4")).toBe("na");
    expect(bossRegionOf("nova2-3")).toBe("sa");
    expect(bossRegionOf("aurora1-9")).toBe("oce");
    expect(bossRegionOf("star4-2")).toBe("eu");
    expect(bossRegionOf("sea1-1")).toBe("sea");
    // An unfamiliar family keeps its own name rather than vanishing into another region.
    expect(bossRegionOf("mars7-3")).toBe("mars");
  });

  test("re-deriving a region already stored on a timer changes nothing", () => {
    // normalizeTimer re-derives on load, so this is what migrates a file written before the
    // second-family mapping existed, and what stops a stable region from drifting afterwards.
    for (const stored of ["na", "sa", "oce", "jp", "eu", "sea", "mars"]) {
      expect(bossRegionOf(stored)).toBe(stored);
    }
    expect(bossRegionOf("sun")).toBe("na");
    expect(bossRegionOf("star")).toBe("eu");
  });

  test("orders regions for display, keeping unknown families after the known ones", () => {
    const shuffled = ["sea", "mars", "na", "eu", "jp"];
    expect([...shuffled].sort(compareBossRegions)).toEqual(["na", "jp", "eu", "sea", "mars"]);
    expect(BOSS_REGIONS).toContain("oce");
  });

  test("groups the regions on screen, filing timers with no region under one tab", () => {
    const timers = [
      bossTimer("Naga", "eu"),
      bossTimer("Wraith", "na"),
      bossTimer("Orc", undefined),
      bossTimer("Fey", "na"),
    ];
    expect(bossRegionsPresent(timers)).toEqual(["na", "eu", UNKNOWN_BOSS_REGION]);
    expect(bossRegionsPresent([])).toEqual([]);
  });

  test("shows the region the player is in until a tab is chosen explicitly", () => {
    const regions = ["na", "eu", "jp"];
    // Nothing chosen: follow the player, so a region hop brings its own timers up unprompted.
    expect(resolveBossRegion(regions, undefined, "eu")).toBe("eu");
    // An explicit choice outranks where the player happens to be standing.
    expect(resolveBossRegion(regions, "jp", "eu")).toBe("jp");
    // A choice whose last timer aged out falls back rather than showing an empty tab.
    expect(resolveBossRegion(regions, "sea", "eu")).toBe("eu");
    // Neither known: the first tab, which is the one already on screen.
    expect(resolveBossRegion(regions, undefined, undefined)).toBe("na");
    expect(resolveBossRegion(regions, undefined, "sea")).toBe("na");
    expect(resolveBossRegion([], "na", "na")).toBeUndefined();
  });

  test("marks a kill the character being played is credited with", () => {
    expect(isOwnBossKill({ killedBy: "Nabooru" }, "Nabooru")).toBe(true);
    // The two strings reach us down different packet paths, so casing and stray space are ignored.
    expect(isOwnBossKill({ killedBy: " nabooru " }, "Nabooru")).toBe(true);
    expect(isOwnBossKill({ killedBy: "Someone Else" }, "Nabooru")).toBe(false);
    // A gravestone with no killer, or no character identified yet, marks nothing rather than
    // matching every other timer that is equally unknown.
    expect(isOwnBossKill({ killedBy: undefined }, "Nabooru")).toBe(false);
    expect(isOwnBossKill({ killedBy: "Nabooru" }, undefined)).toBe(false);
    expect(isOwnBossKill({ killedBy: undefined }, undefined)).toBe(false);
    expect(isOwnBossKill({ killedBy: "  " }, "  ")).toBe(false);
  });

  test("cycles the region tabs in display order, wrapping at the end", () => {
    const regions = ["na", "eu", "jp"];
    expect(nextBossRegion(regions, "na")).toBe("eu");
    expect(nextBossRegion(regions, "jp")).toBe("na");
    // Cycling before anything is showing lands on the first tab rather than doing nothing.
    expect(nextBossRegion(regions, undefined)).toBe("na");
    expect(nextBossRegion(regions, "sea")).toBe("na");
    expect(nextBossRegion([], "na")).toBeUndefined();
  });
});

function bossTimer(mobId: string, region: string | undefined): BossTimer {
  return {
    id: bossTimerKey(mobId, region, 1),
    mobId,
    bossName: mobId,
    ...(region === undefined ? {} : { region }),
    channel: 1,
    diedAtMs: 1_000_000,
    source: "gravestone",
  };
}
