import { describe, expect, test } from "bun:test";

import type { RecordedMobRewardKill } from "@kar-mi/spirit-vale-tools-rewards";

import { chartBuckets, chartSample } from "./reward-chart.ts";

const ORIGIN_MS = 1_700_000_000_000;

describe("reward chart buckets", () => {
  test("bounds the bucket count while summing every kill", () => {
    const kills = Array.from({ length: 5_000 }, (_, index) => kill(index));

    const buckets = chartBuckets(kills, 720);

    expect(buckets.length).toBeGreaterThan(0);
    expect(buckets.length).toBeLessThanOrEqual(720);
    expect(buckets.reduce((total, bucket) => total + bucket.experience, 0))
      .toBe(kills.reduce((total, entry) => total + entry.experience, 0));
    expect(buckets.reduce((total, bucket) => total + bucket.jobExperience, 0))
      .toBe(kills.reduce((total, entry) => total + entry.jobExperience, 0));
    expect(buckets.reduce((total, bucket) => total + bucket.coins, 0n))
      .toBe(kills.reduce((total, entry) => total + entry.coins, 0n));
  });

  test("keeps buckets in chronological order and non-overlapping", () => {
    const buckets = chartBuckets(Array.from({ length: 1_000 }, (_, index) => kill(index)), 50);

    for (const bucket of buckets) expect(bucket.endMs).toBeGreaterThan(bucket.startMs);
    for (let index = 1; index < buckets.length; index += 1) {
      expect(buckets[index]!.startMs).toBeGreaterThanOrEqual(buckets[index - 1]!.endMs);
    }
  });

  test("skips kills that carry no recorded time", () => {
    const timed = kill(0);
    const untimed = { ...kill(1), recordedAt: undefined };

    const buckets = chartBuckets([timed, untimed]);

    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.experience).toBe(timed.experience);
  });

  test("returns nothing when no kill can be placed on a time axis", () => {
    expect(chartBuckets([])).toEqual([]);
    expect(chartBuckets([{ ...kill(0), recordedAt: undefined }])).toEqual([]);
    expect(chartBuckets([{ ...kill(0), recordedAt: "not a date" }])).toEqual([]);
  });

  test("renders a bucket as a trend sample at its end", () => {
    const sample = chartSample({
      startMs: ORIGIN_MS,
      endMs: ORIGIN_MS + 1_000,
      experience: 12,
      jobExperience: 34,
      coins: 56n,
    });

    expect(sample).toEqual({
      recordedAt: new Date(ORIGIN_MS + 1_000).toISOString(),
      experience: 12,
      jobExperience: 34,
      coins: "56",
    });
  });
});

function kill(index: number): RecordedMobRewardKill {
  return {
    kind: "kill",
    id: `kill-${index}`,
    tick: index,
    recordedAt: new Date(ORIGIN_MS + index * 1_000).toISOString(),
    attributed: true,
    mob: {
      objectId: 1_000 + (index % 7),
      mobId: `mob-${index % 7}`,
      displayName: `Mob ${index % 7}`,
      level: 1,
      boss: false,
    },
    experience: index + 1,
    jobExperience: (index + 1) * 2,
    coins: BigInt(index + 1),
    drops: [],
  };
}
