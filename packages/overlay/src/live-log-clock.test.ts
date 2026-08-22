import { expect, test } from "bun:test";

import { OverlayLogClock } from "./live-log-clock.ts";

function fakeWallClock(): { clock: OverlayLogClock; advance(ms: number): void } {
  let wallMs = 10_000;
  const clock = new OverlayLogClock(() => wallMs);
  return { clock, advance: (ms) => { wallMs += ms; } };
}

test("observed times pass through unchanged before any rotation", () => {
  const { clock, advance } = fakeWallClock();
  expect(clock.nowMs()).toBeUndefined();
  expect(clock.observe(0)).toBe(0);
  expect(clock.observe(2_500)).toBe(2_500);
  advance(400);
  expect(clock.nowMs()).toBe(2_900);
});

test("rotation continues the timeline where the previous session left off", () => {
  const { clock, advance } = fakeWallClock();
  clock.observe(60_000);
  advance(250);
  const beforeRotation = clock.nowMs()!;
  expect(beforeRotation).toBe(60_250);

  clock.rotate();
  expect(clock.observe(0)).toBe(60_250);
  expect(clock.observe(1_000)).toBe(61_250);
  advance(500);
  expect(clock.nowMs()).toBe(61_750);
});

test("the timeline stays monotonic across repeated rotations", () => {
  const { clock, advance } = fakeWallClock();
  const seen: number[] = [];
  for (let session = 0; session < 3; session += 1) {
    if (session > 0) clock.rotate();
    for (const observedAtMs of [0, 5_000, 9_000]) {
      seen.push(clock.observe(observedAtMs));
      advance(100);
    }
  }
  const sorted = [...seen].sort((left, right) => left - right);
  expect(seen).toEqual(sorted);
  expect(seen[0]).toBe(0);
  expect(seen.at(-1)).toBeGreaterThan(18_000);
});

test("rotation keeps the clock running before the new session's first event", () => {
  const { clock, advance } = fakeWallClock();
  clock.observe(60_000);
  clock.rotate();
  advance(750);
  expect(clock.nowMs()).toBe(60_750);
  expect(clock.observe(0)).toBe(60_000);
  expect(clock.nowMs()).toBe(60_750);
});

test("rotation before any event leaves the timeline at zero", () => {
  const { clock } = fakeWallClock();
  clock.rotate();
  expect(clock.nowMs()).toBeUndefined();
  expect(clock.observe(0)).toBe(0);
});

test("out-of-order observations do not walk the timeline backwards", () => {
  const { clock, advance } = fakeWallClock();
  clock.observe(5_000);
  advance(200);
  expect(clock.observe(4_000)).toBe(4_000);
  expect(clock.nowMs()).toBe(5_200);
});
