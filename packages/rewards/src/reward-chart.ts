import type { RecordedMobRewardKill, RewardChartBucket } from "@kar-mi/spirit-vale-tools-rewards";

import type { RewardsUiGraphSample } from "./app-types.ts";

/** Chart buckets held for the trend graph. Each bucket sums its members, so totals still reconcile. */
export const CHART_POINTS = 720;
/** Kills held for the recent-kills table. */
export const RECENT_KILL_LIMIT = 100;

export function chartSample(bucket: RewardChartBucket): RewardsUiGraphSample {
  return {
    recordedAt: new Date(bucket.endMs).toISOString(),
    experience: bucket.experience,
    jobExperience: bucket.jobExperience,
    coins: bucket.coins.toString(),
  };
}

/**
 * Buckets kills into at most {@link CHART_POINTS} equal spans, summing each span.
 *
 * Summing rather than sampling is the point: the renderer accumulates these values into the
 * cumulative trend shown next to the session totals, so discarding members would make the chart
 * visibly contradict the totals beside it. Kills without a recorded time cannot be placed on a time
 * axis and are left out of the chart; they still count toward the totals, which come from the
 * snapshot rather than from here.
 */
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
