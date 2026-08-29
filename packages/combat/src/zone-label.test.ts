import { expect, test } from "bun:test";

import { formatZone, formatZoneSummary } from "./zone-label.ts";

test("formats known and unknown map IDs", () => {
  expect(formatZone({ kind: "map", mapId: 1 })).toBe("Nevaris");
  expect(formatZone({ kind: "map", mapId: 22 })).toBe("Worm Nest");
  expect(formatZone({ kind: "map", mapId: 43 })).toBe("Stormreef Isle");
  expect(formatZone({ kind: "map", mapId: 45 })).toBe("Sunken Depths");
  expect(formatZone({ kind: "map", mapId: 49 })).toBe("The Echoing Spire");
  expect(formatZone({ kind: "map", mapId: 999 })).toBe("Zone 999");
  expect(formatZone({ kind: "eternalTower", floor: 12 })).toBe("Eternal Tower - Floor 12");
  expect(formatZone({ kind: "eternalTower" })).toBe("Eternal Tower");
});

test("summarizes a session from its latest distinct zone", () => {
  expect(formatZoneSummary([])).toBeUndefined();
  expect(formatZoneSummary([{ kind: "map", mapId: 49 }])).toBe("The Echoing Spire");
  expect(formatZoneSummary([
    { kind: "map", mapId: 49 },
    { kind: "eternalTower", floor: 1 },
    { kind: "eternalTower", floor: 2 },
  ])).toBe("Eternal Tower - Floor 2 +2");
});
