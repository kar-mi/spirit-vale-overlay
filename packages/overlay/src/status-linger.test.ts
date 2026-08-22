import { expect, test } from "bun:test";

import type { FishNetActiveStatus } from "@kar-mi/spirit-vale-tools-combat";

import { OverlayStatusLinger, STATUS_LINGER_MS } from "./status-linger.ts";

function toggle(statusId: string, appliedAtMs = 0): FishNetActiveStatus {
  return { statusId, displayName: statusId, spriteId: statusId, isDebuff: false, level: 1, appliedAtMs };
}

function timed(statusId: string, expiresAtMs: number): FishNetActiveStatus {
  return { ...toggle(statusId), expiresAtMs, remainingMs: expiresAtMs };
}

test("holds a toggle the server dropped and re-applied within the window", () => {
  const linger = new OverlayStatusLinger();
  linger.apply([toggle("Might")], 0);
  expect(linger.apply([], 400).map((status) => status.statusId)).toEqual(["Might"]);
  expect(linger.apply([toggle("Might")], 800).map((status) => status.statusId)).toEqual(["Might"]);
});

test("lets a toggle go once it has been absent for the whole window", () => {
  const linger = new OverlayStatusLinger();
  linger.apply([toggle("Might")], 0);
  linger.apply([], 100);
  expect(linger.apply([], 100 + STATUS_LINGER_MS)).toHaveLength(1);
  expect(linger.apply([], 100 + STATUS_LINGER_MS + 1)).toHaveLength(0);
});

test("times the hold from the absence, not from the last sighting", () => {
  const linger = new OverlayStatusLinger();
  linger.apply([toggle("Might")], 0);
  const quietGapMs = STATUS_LINGER_MS * 5;
  expect(linger.apply([], quietGapMs)).toHaveLength(1);
  expect(linger.apply([], quietGapMs + STATUS_LINGER_MS)).toHaveLength(1);
});

test("reports the deadline of a held chip, since no event will announce it", () => {
  const linger = new OverlayStatusLinger();
  linger.apply([toggle("Might")], 0);
  expect(linger.nextDeadlineMs()).toBeUndefined();
  linger.apply([], 400);
  expect(linger.nextDeadlineMs()).toBe(400 + STATUS_LINGER_MS);
  linger.apply([toggle("Might")], 500);
  expect(linger.nextDeadlineMs()).toBeUndefined();
});

test("is idempotent for a given now, since the state is derived twice per poll", () => {
  const linger = new OverlayStatusLinger();
  linger.apply([toggle("Might")], 0);
  const first = linger.apply([], 400);
  const second = linger.apply([], 400);
  expect(second).toEqual(first);
});

test("never re-shows a timed buff, whose countdown would be frozen or negative", () => {
  const linger = new OverlayStatusLinger();
  linger.apply([timed("Ferocity", 5_000)], 0);
  expect(linger.apply([], 400)).toHaveLength(0);
});

test("re-inserts a held toggle in application order rather than at the end", () => {
  const linger = new OverlayStatusLinger();
  linger.apply([toggle("Might", 100), toggle("Fury", 200)], 0);
  const rendered = linger.apply([toggle("Fury", 200)], 400);
  expect(rendered.map((status) => status.statusId)).toEqual(["Might", "Fury"]);
});

test("reset drops what was being held", () => {
  const linger = new OverlayStatusLinger();
  linger.apply([toggle("Might")], 0);
  linger.reset();
  expect(linger.apply([], 400)).toHaveLength(0);
});
