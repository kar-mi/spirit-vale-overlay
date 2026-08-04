import { expect, test } from "bun:test";

import { OverlayPublishCadence } from "./publish-cadence.ts";

test("meter cadence stays idle without events and publishes first activity immediately", () => {
  const cadence = new OverlayPublishCadence(1_000);
  expect(cadence.shouldPublishMeter(0)).toBe(false);
  cadence.observeEvents();
  expect(cadence.shouldPublishMeter(100)).toBe(true);
});

test("meter cadence coalesces busy 250 ms polls to one publish per second", () => {
  const cadence = new OverlayPublishCadence(1_000);
  const publishes: number[] = [];
  for (let nowMs = 0; nowMs <= 2_000; nowMs += 250) {
    cadence.observeEvents();
    if (cadence.shouldPublishMeter(nowMs)) publishes.push(nowMs);
  }
  expect(publishes).toEqual([0, 1_000, 2_000]);
});

test("finalized meters stop ticking and reset allows the next encounter to publish immediately", () => {
  const cadence = new OverlayPublishCadence(1_000);
  cadence.observeEvents();
  expect(cadence.shouldPublishMeter(0)).toBe(true);
  cadence.recordMeterState(false);
  expect(cadence.shouldPublishMeter(1_000)).toBe(false);
  cadence.reset();
  cadence.observeEvents();
  expect(cadence.shouldPublishMeter(1_100)).toBe(true);
});
