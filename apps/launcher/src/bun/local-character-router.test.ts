import { describe, expect, test } from "bun:test";

import type { CharacterSnapshot, CharacterViewState } from "@kar-mi/spirit-vale-tools-character";
import type { CapturedFishNetPacket } from "@kar-mi/spirit-vale-tools-capture";

import { LocalCharacterRouter } from "./local-character-router.ts";

describe("local character router", () => {
  test("consumes character callbacks before connection admission without rewriting them", () => {
    const tracker = new FakeCharacterTracker();
    const router = new LocalCharacterRouter({ tracker });
    const callback = packet("rpcLink", "conn-b", {
      rpcName: "CharacterCallback_T",
      rpcResolution: "verified",
    });

    expect(router.consumeBeforeAdmission(callback)).toBe(true);
    expect(router.consumeAdmitted(callback)).toBe(false);
    expect(tracker.packets).toEqual([callback]);
  });

  test("normalizes accepted local objects while keeping remote objects isolated", () => {
    const tracker = new FakeCharacterTracker();
    const router = new LocalCharacterRouter({ tracker });

    expect(router.consumeAdmitted(packet("authenticated", "conn-a"))).toBe(false);
    router.consumeAdmitted(packet("serverRpc", "conn-a", { objectId: 202 }));
    router.consumeAdmitted(packet("syncType", "conn-b", { objectId: 202, networkBehaviourType: "HealthComponent" }));
    router.consumeAdmitted(packet("syncType", "conn-b", { objectId: 999, networkBehaviourType: "HealthComponent" }));

    expect(router.physicalObjectId()).toBe(202);
    expect(tracker.packets.map(({ connectionId, objectId }) => [connectionId, objectId])).toEqual([
      ["spiritvale-active-character", -1],
      ["spiritvale-active-character", -1],
      ["spiritvale-active-character", 999],
    ]);
  });

  test("keeps one logical object when a map assigns a new physical player object", () => {
    const tracker = new FakeCharacterTracker();
    const router = new LocalCharacterRouter({ tracker });

    router.consumeAdmitted(packet("serverRpc", "conn-a", { objectId: 202 }));
    router.consumeAdmitted(packet("serverRpc", "conn-b", { objectId: 303 }));

    expect(router.physicalObjectId()).toBe(303);
    expect(tracker.packets.map(({ connectionId, objectId }) => [connectionId, objectId])).toEqual([
      ["spiritvale-active-character", -1],
      ["spiritvale-active-character", -1],
    ]);
  });

  test("contains tracker failures and reports the original packet", () => {
    const tracker = new FakeCharacterTracker();
    const failure = new Error("bad character payload");
    tracker.failure = failure;
    const errors: Array<[CapturedFishNetPacket, unknown]> = [];
    let handled = 0;
    const router = new LocalCharacterRouter({
      tracker,
      onHandled: () => handled += 1,
      onError: (failedPacket, error) => errors.push([failedPacket, error]),
    });
    const failedPacket = packet("serverRpc", "conn-a", { objectId: 202 });

    expect(router.consumeAdmitted(failedPacket)).toBe(true);
    expect(errors).toEqual([[failedPacket, failure]]);
    expect(handled).toBe(0);
  });
});

class FakeCharacterTracker {
  readonly packets: CapturedFishNetPacket[] = [];
  failure?: Error;
  private snapshot?: CharacterSnapshot;

  consume(packet: CapturedFishNetPacket): boolean {
    if (this.failure) throw this.failure;
    this.packets.push(packet);
    return true;
  }

  current(): CharacterSnapshot | undefined {
    return this.snapshot;
  }

  currentArchetypeId(): number | undefined {
    return undefined;
  }

  setCached(snapshot: CharacterSnapshot | undefined): void {
    this.snapshot = snapshot;
  }

  state(): CharacterViewState {
    return {
      ...(this.snapshot === undefined ? {} : { snapshot: this.snapshot }),
      stats: [],
      gearTotals: [],
      status: this.snapshot === undefined ? "waiting" : "cached",
      statusDetail: "test",
    };
  }

  subscribe(_listener: (state: CharacterViewState) => void): () => void {
    return () => {};
  }
}

function packet(
  packetName: CapturedFishNetPacket["packetName"],
  connectionId: string,
  extra: Partial<CapturedFishNetPacket> = {},
): CapturedFishNetPacket {
  return {
    tick: 1,
    packetId: 1,
    packetName,
    raw: Buffer.alloc(0),
    payload: Buffer.alloc(0),
    connectionId,
    ...extra,
  } as CapturedFishNetPacket;
}
