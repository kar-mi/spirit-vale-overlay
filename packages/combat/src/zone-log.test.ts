import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  locationFromLogData,
  readCombatLocations,
  TOWER_FLOOR_EVENT_SOURCE_PREFIX,
  TOWER_FLOOR_UNKNOWN_SUFFIX,
  ZONE_EVENT_SOURCE_PREFIX,
} from "./zone-log.ts";

test("reads ordered zone changes and ignores unrelated or malformed records", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-zones-"));
  const file = path.join(directory, "combat.jsonl");
  const record = (sourceId: string, sequence: number) => JSON.stringify({
    schemaVersion: 1, sessionId: "test", sequence, recordedAt: "2026-01-01T00:00:00.000Z",
    source: "test", type: "combat.event",
    data: { kind: "activation", tick: sequence, actorId: 0, sourceId, sourceLabel: "Zone" },
  });
  try {
    await writeFile(file, [
      record(`${ZONE_EVENT_SOURCE_PREFIX}17`, 1),
      record(`${ZONE_EVENT_SOURCE_PREFIX}17`, 2),
      record("BasicAttack", 3),
      "not json",
      record(`${ZONE_EVENT_SOURCE_PREFIX}29`, 4),
      record(`${TOWER_FLOOR_EVENT_SOURCE_PREFIX}3`, 5),
      record(`${TOWER_FLOOR_EVENT_SOURCE_PREFIX}3`, 6),
      record(`${ZONE_EVENT_SOURCE_PREFIX}17`, 7),
    ].join("\n"));
    expect(await readCombatLocations(file)).toEqual([
      { kind: "map", mapId: 17 },
      { kind: "map", mapId: 29 },
      { kind: "eternalTower", floor: 3 },
      { kind: "map", mapId: 17 },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("accepts only a valid zone marker", () => {
  expect(locationFromLogData({ kind: "activation", sourceId: `${ZONE_EVENT_SOURCE_PREFIX}17` }))
    .toEqual({ kind: "map", mapId: 17 });
  expect(locationFromLogData({ kind: "activation", sourceId: `${TOWER_FLOOR_EVENT_SOURCE_PREFIX}8` }))
    .toEqual({ kind: "eternalTower", floor: 8 });
  expect(locationFromLogData({ kind: "activation", sourceId: `${TOWER_FLOOR_EVENT_SOURCE_PREFIX}${TOWER_FLOOR_UNKNOWN_SUFFIX}` }))
    .toEqual({ kind: "eternalTower" });
  expect(locationFromLogData({ kind: "activation", sourceId: `${ZONE_EVENT_SOURCE_PREFIX}-1` })).toBeUndefined();
  expect(locationFromLogData({ kind: "damage", sourceId: `${ZONE_EVENT_SOURCE_PREFIX}17` })).toBeUndefined();
});
