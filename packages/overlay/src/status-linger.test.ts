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
  // The server churns group boons: an explicit remove, then the same status back a fraction of a
  // second later. Without the hold that gap renders as a blink.
  expect(linger.apply([], 400).map((status) => status.statusId)).toEqual(["Might"]);
  expect(linger.apply([toggle("Might")], 800).map((status) => status.statusId)).toEqual(["Might"]);
});

test("lets a toggle go once it has been absent for the whole window", () => {
  const linger = new OverlayStatusLinger();
  linger.apply([toggle("Might")], 0);
  expect(linger.apply([], STATUS_LINGER_MS)).toHaveLength(1);
  expect(linger.apply([], STATUS_LINGER_MS + 1)).toHaveLength(0);
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
