import type { RecordedMobRewardKill, RewardChartBucket } from "@kar-mi/spirit-vale-tools-rewards";

import type { RewardsUiGraphSample } from "./app-types.ts";

export const CHART_POINTS = 720;
export const RECENT_KILL_LIMIT = 100;

export function chartSample(bucket: RewardChartBucket): RewardsUiGraphSample {
  return {
    recordedAt: new Date(bucket.endMs).toISOString(),
    experience: bucket.experience,
    jobExperience: bucket.jobExperience,
    coins: bucket.coins.toString(),
  };
}

export function chartBuckets(kills: readonly RecordedMobRewardKill[], maxPoints = CHART_POINTS): RewardChartBucket[] {
  const timed = kills.flatMap((kill) => {
    if (kill.recordedAt === undefined) return [];
    const atMs = Date.parse(kill.recordedAt);
    return Number.isNaN(atMs) ? [] : [{ atMs, kill }];
  }).sort((left, right) => left.atMs - right.atMs);
  if (timed.length === 0) return [];

  const startMs = timed[0]!.atMs;
  const endMs = timed.at(-1)!.atMs;
  const width = Math.max(1, Math.ceil((endMs - startMs + 1) / maxPoints));
  const buckets = new Map<number, RewardChartBucket>();
  for (const { atMs, kill } of timed) {
    const index = Math.floor((atMs - startMs) / width);
    const bucket = buckets.get(index) ?? {
      startMs: startMs + index * width,
      endMs: startMs + (index + 1) * width,
      experience: 0,
      jobExperience: 0,
      coins: 0n,
    };
    bucket.experience += kill.experience;
    bucket.jobExperience += kill.jobExperience;
    bucket.coins += kill.coins;
    buckets.set(index, bucket);
  }
  return [...buckets.entries()].sort(([left], [right]) => left - right).map(([, bucket]) => bucket);
}
