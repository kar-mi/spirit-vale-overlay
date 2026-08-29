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

  test("clears an identity on despawn once evidence marks its object as a summon/clone", () => {
    const actors = new StickyActorDirectory();
    actors.consume(playerIdentity(1, 789, "Temporary Name"));
    actors.consume(summonSync(2, 789, "SummonerSync"));

    expect(actors.consume(packet(3, "objectDespawn", 789))).toEqual([
      { kind: "actorIdentity", operation: "remove", tick: 3, actorId: 789 },
    ]);
    expect(actors.getAttribution(789)).toBeUndefined();
  });

  test("does not mistake the owner's own SummoningComponent traffic (PrimarySync) for a summon", () => {
    const actors = new StickyActorDirectory();
    actors.consume(playerIdentity(1, 123, "Fictional Ranger"));
    actors.consume(summonSync(2, 123, "PrimarySync"));

    expect(actors.consume(packet(3, "objectDespawn", 123))).toEqual([]);
    expect(actors.getAttribution(123)).toMatchObject({ displayName: "Fictional Ranger" });
  });

  test("despawning a summon/clone that never had an attributed identity is a harmless no-op", () => {
    const actors = new StickyActorDirectory();
    actors.consume(summonSync(1, 456, "SummonerSync"));
    expect(actors.consume(packet(2, "objectDespawn", 456))).toEqual([]);
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

function summonSync(tick: number, objectId: number, fieldName: "SummonerSync" | "PrimarySync"): DecodedFishNetPacket {
  return {
    ...packet(tick, "syncType", objectId),
    networkBehaviourType: "SummoningComponent",
    syncIndex: fieldName === "SummonerSync" ? 0 : 1,
    syncName: fieldName,
    decodedFields: [{ name: fieldName, codec: "packedInt32", value: 999 }],
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
