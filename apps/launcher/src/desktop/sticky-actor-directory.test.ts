import { describe, expect, test } from "bun:test";

import type { DecodedFishNetPacket } from "@kar-mi/spirit-vale-tools-capture";
import { StickyActorDirectory } from "./sticky-actor-directory.ts";

describe("StickyActorDirectory", () => {
  test("retains a directly decoded player identity across despawn", () => {
    const actors = new StickyActorDirectory();
    actors.consume(playerIdentity(1, 123, "Fictional Ranger"));

    expect(actors.consume(packet(2, "objectDespawn", 123))).toEqual([]);
    expect(actors.getAttribution(123)).toMatchObject({ displayName: "Fictional Ranger" });
  });

  test("clears a retained player identity on direct monster data", () => {
    const actors = new StickyActorDirectory();
    actors.consume(playerIdentity(1, 123, "Fictional Ranger"));
    actors.consume(packet(2, "objectDespawn", 123));

    expect(actors.consume(monsterIdentity(3, 123))).toEqual([
      { kind: "actorIdentity", operation: "remove", tick: 3, actorId: 123 },
    ]);
    expect(actors.getAttribution(123)).toBeUndefined();
  });
});

function packet(tick: number, packetName: DecodedFishNetPacket["packetName"], objectId: number): DecodedFishNetPacket {
  return { tick, packetId: 1, packetName, objectId, raw: Buffer.alloc(0), payload: Buffer.alloc(0) };
}

function playerIdentity(tick: number, objectId: number, displayName: string): DecodedFishNetPacket {
  return {
    ...packet(tick, "syncType", objectId),
    networkBehaviourType: "PlayerController",
    syncIndex: 5,
    syncName: "VisualData",
    decodedFields: [
      { name: "Appearance.DisplayName", codec: "stringUtf8Packed", value: displayName },
      { name: "Appearance.Archetype", codec: "packedInt32", value: 8 },
    ],
  };
}

function monsterIdentity(tick: number, objectId: number): DecodedFishNetPacket {
  return {
    ...packet(tick, "syncType", objectId),
    networkBehaviourType: "MonsterController",
    syncIndex: 0,
    syncName: "Data",
    decodedFields: [
      { name: "Data.Id", codec: "stringUtf8Packed", value: "NightmareShadow" },
      { name: "Data.Level", codec: "packedInt32", value: 150 },
    ],
  };
}
