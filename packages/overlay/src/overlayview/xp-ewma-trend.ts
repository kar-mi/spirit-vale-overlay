const EWMA_TAU_SECONDS = 20;

export interface XpBucket {
  atMs: number;
  experience: number;
}

export interface XpEwmaPoint {
  time: number;
  value: number;
}

/**
 * Reconstructs the XP tracker's 20-second EWMA at one-second intervals. Buckets before the visible
 * range seed the rate so the left edge continues smoothly instead of restarting from zero.
 */
export function buildXpEwmaTrend(
  buckets: readonly XpBucket[],
  range: { start: number; end: number },
): XpEwmaPoint[] {
  if (range.end <= range.start) return [];

  let bucketIndex = 0;
  let rate = 0;
  let updatedAtMs = buckets[0]?.atMs ?? range.start;

  function advance(toMs: number): void {
    rate *= Math.exp(-Math.max(0, toMs - updatedAtMs) / 1000 / EWMA_TAU_SECONDS);
    updatedAtMs = Math.max(updatedAtMs, toMs);
  }

  function consumeThrough(toMs: number): void {
    while (bucketIndex < buckets.length) {
      const bucket = buckets[bucketIndex];
      if (!bucket || bucket.atMs > toMs) break;
      advance(bucket.atMs);
      rate += bucket.experience / EWMA_TAU_SECONDS;
      bucketIndex += 1;
    }
    advance(toMs);
  }

  consumeThrough(range.start);
  const points: XpEwmaPoint[] = [{ time: range.start, value: rate }];

  let nextSecond = Math.ceil(range.start / 1000) * 1000;
  if (nextSecond <= range.start) nextSecond += 1000;
  while (nextSecond < range.end) {
    consumeThrough(nextSecond);
    points.push({ time: nextSecond, value: rate });
    nextSecond += 1000;
  }

  consumeThrough(range.end);
  points.push({ time: range.end, value: rate });
  return points;
}
