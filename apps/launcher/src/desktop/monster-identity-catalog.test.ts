import { expect, test } from "bun:test";

import { FishNetCombatTracker } from "@kar-mi/spirit-vale-tools-combat";
import { mobDefinitionsById } from "@kar-mi/spirit-vale-tools-rewards";
import { combatMonsterIdentityCatalog } from "./monster-identity-catalog.ts";

test("adds datamine-backed non-reward monsters without changing the reward catalog", () => {
  const rewardMobs = mobDefinitionsById();
  const combatMobs = combatMonsterIdentityCatalog();

  expect(rewardMobs.has("NightmareShadow")).toBe(false);
  expect(combatMobs.get("NightmareShadow")).toEqual({
    id: "NightmareShadow",
    displayName: "Curse Manifestation",
    level: 0,
  });
  expect(combatMobs.size).toBe(rewardMobs.size + 7);
});

test("decodes a catalog-only monster identity from direct MonsterController.Data fields", () => {
  const tracker = new FishNetCombatTracker({ monsterCatalog: combatMonsterIdentityCatalog() });

  expect(tracker.consume({
    tick: 1,
    packetId: 1,
    packetName: "syncType",
    objectId: 123,
    networkBehaviourType: "MonsterController",
    syncIndex: 0,
    syncName: "Data",
    decodedFields: [
      { name: "Data.Id", codec: "stringUtf8Packed", value: "NightmareShadow" },
      { name: "Data.Level", codec: "packedInt32", value: 150 },
    ],
    raw: Buffer.alloc(0),
    payload: Buffer.alloc(0),
  })).toContainEqual(expect.objectContaining({
    kind: "monsterIdentity",
    actorId: 123,
    displayName: "Curse Manifestation",
  }));
});
