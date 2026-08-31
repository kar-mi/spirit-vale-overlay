import { expect, test } from "bun:test";

import { matchesZoneKeys, spiritValeLocationKey } from "./location.ts";

test("distinguishes maps, tower floors, and an unknown tower floor", () => {
  expect(spiritValeLocationKey({ kind: "map", mapId: 17 })).toBe("map:17");
  expect(spiritValeLocationKey({ kind: "eternalTower", floor: 0 })).toBe("tower:0");
  expect(spiritValeLocationKey({ kind: "eternalTower" })).toBe("tower:unknown");
});

test("matches a session that visited any selected zone", () => {
  const locations = [{ kind: "map", mapId: 17 }, { kind: "eternalTower", floor: 3 }] as const;
  expect(matchesZoneKeys(locations, [])).toBe(true);
  expect(matchesZoneKeys(locations, ["tower:3"])).toBe(true);
  expect(matchesZoneKeys(locations, ["map:99", "map:17"])).toBe(true);
  expect(matchesZoneKeys(locations, ["map:99"])).toBe(false);
});

test("treats a session with unknown zones as unmatched only while a zone is selected", () => {
  expect(matchesZoneKeys(undefined, [])).toBe(true);
  expect(matchesZoneKeys(undefined, ["map:17"])).toBe(false);
  expect(matchesZoneKeys([], ["map:17"])).toBe(false);
});
