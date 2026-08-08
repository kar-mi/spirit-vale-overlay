import { describe, expect, test } from "bun:test";

import { LiveRewardService } from "@kar-mi/spirit-vale-tools-rewards";
import type { FishNetMobRewardEvent } from "@kar-mi/spirit-vale-tools-rewards";

const RECENT_KILL_LIMIT = 100;
const CHART_POINTS = 720;

/**
 * The rewards window renders its trend chart from the aggregator's buckets and its totals from the
 * same snapshot, in the same panel. A bucketing that samples rather than sums makes the two
 * disagree — which is exactly what the removed `compactSnapshot` did past 720 kills.
 */
describe("bounded reward aggregation", () => {
  test("chart stays bounded while its sums still equal the totals", () => {
    const service = new LiveRewardService({ recentKillLimit: RECENT_KILL_LIMIT, chartPoints: CHART_POINTS });
    const killCount = 5_000;
    for (let index = 0; index < killCount; index += 1) {
      service.consume(kill(index), { recordedAt: new Date(1_700_000_000_000 + index * 1_000).toISOString() });
    }

    const snapshot = service.snapshot();
    expect(snapshot.killCount).toBe(killCount);
    expect(snapshot.chart.length).toBeLessThanOrEqual(CHART_POINTS);

    const charted = snapshot.chart.reduce((total, bucket) => total + bucket.experience, 0);
    expect(charted).toBe(snapshot.totalExperience);

    const chartedJob = snapshot.chart.reduce((total, bucket) => total + bucket.jobExperience, 0);
    expect(chartedJob).toBe(snapshot.totalJobExperience);

    const chartedCoins = snapshot.chart.reduce((total, bucket) => total + bucket.coins, 0n);
    expect(chartedCoins).toBe(snapshot.totalCoins);
  });

  test("recent kills are the newest consecutive kills, not a scattered sample", () => {
    const service = new LiveRewardService({ recentKillLimit: RECENT_KILL_LIMIT, chartPoints: CHART_POINTS });
    const killCount = 5_000;
    for (let index = 0; index < killCount; index += 1) {
      service.consume(kill(index), { recordedAt: new Date(1_700_000_000_000 + index * 1_000).toISOString() });
    }

    const { recentKills } = service.snapshot();
    expect(recentKills).toHaveLength(RECENT_KILL_LIMIT);
    // Newest first, and every kill adjacent to the next — no gaps from stride sampling.
    expect(recentKills.map((entry) => entry.experience))
      .toEqual(Array.from({ length: RECENT_KILL_LIMIT }, (_, offset) => killCount - 1 - offset));
  });
});

function kill(index: number): FishNetMobRewardEvent {
  return {
    kind: "kill",
    id: `kill-${index}`,
    tick: index,
    attributed: true,
    mob: {
      objectId: 1_000 + (index % 7),
      mobId: `mob-${index % 7}`,
      displayName: `Mob ${index % 7}`,
      level: 1,
      boss: false,
    },
    experience: index,
    jobExperience: index * 2,
    coins: BigInt(index),
    drops: [],
  };
}
