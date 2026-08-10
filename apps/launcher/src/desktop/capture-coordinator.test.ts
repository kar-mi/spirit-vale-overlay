import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CharacterSnapshot } from "@kar-mi/spirit-vale-tools-character";
import { DpsSessionLogFollower } from "@kar-mi/spirit-vale-tools-combat";
import type { CapturedFishNetPacket, CapturedLiteNetLibPacket, CaptureConfig } from "@kar-mi/spirit-vale-tools-capture";
import type { PacketCapture } from "@kar-mi/spirit-vale-tools-capture/capture";
import { isLogStreamHeader, readCurrentLogStream } from "@kar-mi/spirit-vale-tools-logging";
import { MarketSessionLogFollower } from "@kar-mi/spirit-vale-tools-market";
import { RewardSessionLogFollower } from "@kar-mi/spirit-vale-tools-rewards";

import { CaptureCoordinator } from "./capture-coordinator.ts";

describe("central capture coordinator", () => {
  test("reports a missing game once until it has been detected again", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-missing-game-"));
    const capture = new FakeCapture();
    const errorReports: Array<{ title: string; reason: string; details?: Readonly<Record<string, unknown>> }> = [];
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        onError: (report) => errorReports.push(report),
      });
      await coordinator.start();

      capture.target("waiting");
      expect(errorReports).toHaveLength(1);
      expect(errorReports[0]).toMatchObject({
        title: "Game was not detected for capture",
        reason: expect.stringContaining("SpiritVale.exe was not found by Windows process inspection"),
        details: { "Expected process": "SpiritVale.exe" },
      });

      capture.target("active", [4242]);
      capture.target("waiting");
      capture.target("waiting");
      expect(errorReports).toHaveLength(2);
      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("reports game and data activity after target status arrives before capture startup", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-status-"));
    const capture = new FakeCapture();
    capture.initialTargetState = "active";
    const errorReports: Array<{ title: string; reason: string; details?: Readonly<Record<string, unknown>> }> = [];
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        onError: (report) => errorReports.push(report),
      });
      await coordinator.start();

      expect(coordinator.state()).toEqual({
        captureStatus: "capturing",
        statusDetail: "Capture Active - Waiting on data (change channel/map if recently launched).",
      });

      capture.packet(authenticatedPacket(1, "test-connection"));
      expect(coordinator.state().statusDetail).toBe("Capture Active");

      capture.target("waiting");
      expect(coordinator.state().statusDetail).toBe("Capture Active - Game not running");

      capture.target("active", [4242]);
      expect(coordinator.state().statusDetail).toBe("Capture Active - Waiting on data (change channel/map if recently launched).");
      capture.target("active", [4242]);
      expect(errorReports.map((report) => report.title)).toEqual([
        "Game was not detected for capture",
        "Game detected, but capture is waiting for data",
      ]);
      expect(errorReports[1]).toMatchObject({
        reason: expect.stringContaining("has not received game network data since it was last detected"),
        details: {
          "Expected process": "SpiritVale.exe",
          "Network adapter": "Automatic selection",
        },
      });
      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("adds the diagnostic stream only when development diagnostics are enabled", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        diagnosticLogging: true,
      });
      await coordinator.start();

      capture.packet({ tick: 1, packetId: 0, packetName: "authenticated", raw: Buffer.alloc(0), payload: Buffer.alloc(0) });
      capture.packet(experiencePacket(2, 0, 0n));
      capture.packet(experiencePacket(3, 10, 2n));
      capture.packet(marketListingPacket(4));
      capture.packet({ tick: 5, packetId: 2, packetName: "pingPong", raw: Buffer.alloc(0), payload: Buffer.alloc(0) });
      await coordinator.stop();

      const pointers = await Promise.all(["combat", "rewards", "market", "other"].map((stream) => {
        return readCurrentLogStream(stream as "combat" | "rewards" | "market" | "other", directory);
      }));
      expect(new Set(pointers.map((pointer) => pointer?.sessionId)).size).toBe(1);
      expect(pointers.every((pointer) => pointer !== undefined)).toBe(true);

      const streams = await Promise.all(pointers.map(async (pointer) => {
        return records(await readFile(pointer!.path, "utf8"));
      }));
      const combat = streams[0]!;
      const rewards = streams[1]!;
      const market = streams[2]!;
      const other = streams[3]!;
      expect(combat.map((record) => record.type)).toContain("combat.actorIdentity");
      expect(rewards.map((record) => record.type)).toContain("rewards.unmatched");
      expect(market.map((record) => record.type)).toContain("market.event");
      expect(other.filter((record) => record.type === "fishnet.packet")).toHaveLength(2);
      expect(other.at(-1)?.type).toBe("capture.lifecycle");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("diagnostic mode traces map-transition wire traffic, connection admission, and status decoding", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-transition-diagnostics-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        diagnosticLogging: true,
      });
      await coordinator.start();

      const now = Date.now();
      capture.liteNet(liteNetPacket(new Date(now - 6_000), Buffer.from("too-old")));
      capture.liteNet(liteNetPacket(new Date(now - 100), Buffer.from("before")));
      capture.packet(authenticatedPacket(1_000, "conn-a"));
      capture.packet(statusPacket(1_010, 10, "conn-b"));
      capture.packet(authenticatedPacket(50, "conn-b"));
      capture.packet(statusPacket(60, 20, "conn-b"));
      capture.liteNet(liteNetPacket(new Date(now + 100), Buffer.from("after")));
      await coordinator.stop();

      const pointer = await readCurrentLogStream("other", directory);
      const diagnosticRecords = records(await readFile(pointer!.path, "utf8")) as Array<{
        type: string;
        data: Record<string, unknown>;
      }>;
      const wire = diagnosticRecords.filter((record) => record.type === "capture.liteNetPacket");
      expect(wire.map((record) => record.data.phase)).toContain("before-authenticated");
      expect(wire.map((record) => record.data.phase)).toContain("after-authenticated");
      const firstTransition = diagnosticRecords.find((record) => record.type === "capture.mapTransition");
      expect(firstTransition?.data).toMatchObject({ bufferedLiteNetPackets: 1, droppedBufferedPackets: 1 });

      const admissions = diagnosticRecords.filter((record) => record.type === "capture.packetAdmission");
      expect(admissions.some((record) => record.data.decision === "rejected"
        && record.data.reason === "inactive-connection"
        && record.data.rpcName === "ApplyEffect_T")).toBe(true);
      expect(admissions.some((record) => record.data.decision === "accepted"
        && record.data.rpcName === "ApplyEffect_T")).toBe(true);

      const statuses = diagnosticRecords.filter((record) => record.type === "capture.statusPacket");
      expect(statuses.filter((record) => record.data.phase === "input")).toHaveLength(2);
      const output = statuses.find((record) => record.data.phase === "output");
      expect(output?.data.statusEvents).toEqual([expect.objectContaining({
        kind: "status",
        actorId: 20,
        statusId: "Haste",
        action: "applied",
      })]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("captures all three domains before their log followers are opened", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-late-open-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        diagnosticLogging: false,
      });
      await coordinator.start();

      capture.packet(authenticatedPacket(1, "test-connection"));
      capture.packet(experiencePacket(2, 0, 0n));
      capture.packet(experiencePacket(3, 10, 2n));
      capture.packet(marketListingPacket(4));
      capture.packet({
        tick: 5,
        packetId: 5,
        packetName: "objectSpawn",
        objectId: 40,
        ownerConnectionId: 9,
        spawnSyncPayload: Buffer.from([1, 2, 3, 4]),
        raw: Buffer.alloc(0),
        payload: Buffer.alloc(0),
      });
      await coordinator.stop();

      // Polling a follower subscribes it to the shared stream source, which holds watchers and a
      // fallback timer until every subscriber lets go. Closing keeps this test from leaving them
      // behind for the rest of the run.
      const combatFollower = new DpsSessionLogFollower(directory);
      const rewardsFollower = new RewardSessionLogFollower(directory);
      const marketFollower = new MarketSessionLogFollower(directory);
      const combat = await combatFollower.poll();
      const rewards = await rewardsFollower.poll();
      const market = await marketFollower.poll();
      combatFollower.close();
      rewardsFollower.close();
      marketFollower.close();
      expect(new Set([combat.sessionId, rewards.sessionId, market.sessionId]).size).toBe(1);
      expect(combat.events.length).toBeGreaterThan(0);
      expect(rewards.snapshot.unmatched).toBeGreaterThan(0);
      expect(market).toMatchObject({ missing: false, status: "stopped" });
      expect(market.listings.map((listing) => listing.id)).toEqual(["listing-a"]);
      expect(await readCurrentLogStream("other", directory)).toBeUndefined();

      const combatPointer = await readCurrentLogStream("combat", directory);
      const combatRecords = records(await readFile(combatPointer!.path, "utf8"));
      expect(combatRecords.some((record) => record.type === "combat.spawnIdentityMiss")).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("writes the cached local character archetype onto serverRpc actor identities", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-local-class-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
      });
      coordinator.setCachedCharacter(syntheticCachedCharacter());
      await coordinator.start();

      capture.packet(authenticatedPacket(1, "test-connection"));
      capture.packet({
        tick: 2,
        packetId: 1,
        packetName: "objectSpawn",
        objectId: 80,
        ownerConnectionId: 31,
        rpcLinkRegistrations: [{
          linkId: 980,
          objectId: 80,
          componentIndex: 0,
          rpcHash: 1,
          packetName: "observersRpc",
          networkBehaviourType: "PlayerController",
        }],
        raw: Buffer.alloc(0),
        payload: Buffer.alloc(0),
      });
      capture.packet({
        tick: 3,
        packetId: 2,
        packetName: "serverRpc",
        objectId: 80,
        raw: Buffer.alloc(0),
        payload: Buffer.alloc(0),
      });
      await coordinator.stop();

      const combatPointer = await readCurrentLogStream("combat", directory);
      const combat = records(await readFile(combatPointer!.path, "utf8")) as Array<{
        type: string;
        data?: Record<string, unknown>;
      }>;
      expect(combat).toContainEqual(expect.objectContaining({
        type: "combat.actorIdentity",
        data: expect.objectContaining({
          operation: "upsert",
          actorId: 80,
          displayName: "Fictional Hero",
          archetype: 12,
        }),
      }));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("specializes drain healing only for the local character build", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-drain-healing-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
      });
      const snapshot = syntheticCachedCharacter();
      snapshot.equipment = [{
        slot: "Rune",
        itemId: "Fictional Leech Item",
        refine: 0,
        cards: [],
        substats: [{ type: 98, name: "Health Leech", roll: 0, value: 4, percent: true }],
      }];
      coordinator.setCachedCharacter(snapshot);
      await coordinator.start();

      capture.packet(authenticatedPacket(1, "test-connection"));
      capture.packet({
        tick: 2,
        packetId: 2,
        packetName: "serverRpc",
        objectId: 80,
        raw: Buffer.alloc(0),
        payload: Buffer.alloc(0),
      });
      capture.packet(recoverPacket(3, 80, 200));
      capture.packet(recoverPacket(4, 90, 300));
      await coordinator.stop();

      const combatPointer = await readCurrentLogStream("combat", directory);
      const combat = records(await readFile(combatPointer!.path, "utf8")) as Array<{
        type: string;
        data?: Record<string, unknown>;
      }>;
      expect(combat).toContainEqual(expect.objectContaining({
        type: "combat.event",
        data: expect.objectContaining({
          kind: "heal",
          actorId: 80,
          targetId: 80,
          sourceId: "health-leech",
          sourceLabel: "Health Leech",
          recoveryStyle: "drain",
          value: 200,
        }),
      }));
      expect(combat).toContainEqual(expect.objectContaining({
        type: "combat.event",
        data: expect.objectContaining({
          kind: "heal",
          actorId: 90,
          targetId: 90,
          sourceId: "siphon-health-leech",
          sourceLabel: "Siphon / Health Leech",
          recoveryStyle: "drain",
          value: 300,
        }),
      }));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("writes an owner-resolved identity before damage from an observed player actor", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-combat-identity-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
      });
      await coordinator.start();

      capture.packet(authenticatedPacket(1, "test-connection"));
      capture.packet(ownedSpawnPacket(2, 40, 7, "PlayerController"));
      capture.packet(ownedSpawnPacket(3, 140, 7, "UnrecognizedComponent"));
      capture.packet(identityPacket(4, 40, "Aster Vale", "test-connection"));
      capture.packet(damagePacket(5, 900, 140));
      await coordinator.stop();

      const combatPointer = await readCurrentLogStream("combat", directory);
      const combat = records(await readFile(combatPointer!.path, "utf8")) as Array<{
        type: string;
        data?: { actorId?: number; displayName?: string };
      }>;
      const resolvedIndex = combat.findIndex((record) => record.type === "combat.actorIdentity"
        && record.data?.actorId === 140
        && record.data.displayName === "Aster Vale");
      const damageIndex = combat.findIndex((record) => record.type === "combat.event"
        && record.data?.actorId === 140);

      expect(resolvedIndex).toBeGreaterThan(-1);
      expect(damageIndex).toBeGreaterThan(resolvedIndex);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("logs only local reward kills and attributes a coalesced reward to the local group", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-local-rewards-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
      });
      coordinator.setCachedCharacter(syntheticCachedCharacter());
      await coordinator.start();

      capture.packet(authenticatedPacket(1, "test-connection"));
      capture.packet({
        tick: 2,
        packetId: 10,
        packetName: "serverRpc",
        objectId: 10,
        rpcName: "SyntheticLocalCallback_C",
        raw: Buffer.alloc(0),
        payload: Buffer.alloc(0),
      });
      capture.packet(identityPacket(3, 10, "Fictional Hero", "test-connection"));
      capture.packet(monsterIdentityPacket(4, 900));
      capture.packet(monsterIdentityPacket(5, 901));
      capture.packet(monsterIdentityPacket(6, 902));
      capture.packet(experiencePacket(7, 0, 0n));

      const otherDeath = damagePacket(9, 900, 20);
      otherDeath.rpcName = "Death_C";
      capture.packet(otherDeath);

      for (const [tick, target] of [[10, 901], [11, 902]] as const) {
        capture.packet(damagePacket(tick, target, 10));
        const death = damagePacket(tick + 1, target, 10);
        death.rpcName = "Death_C";
        capture.packet(death);
      }
      capture.packet(experiencePacket(14, 200, 20n));
      capture.packet({ tick: 80, packetId: 2, packetName: "pingPong", raw: Buffer.alloc(0), payload: Buffer.alloc(0) });
      await coordinator.stop();

      const pointer = await readCurrentLogStream("rewards", directory);
      const rewardRecords = records(await readFile(pointer!.path, "utf8")) as Array<{
        type: string;
        data?: { kind?: string; attributed?: boolean; experience?: number; mob?: { objectId?: number } };
      }>;
      const kills = rewardRecords.filter((record) => record.type === "rewards.kill");
      expect(kills.map((record) => record.data?.mob?.objectId)).toEqual([901, 902]);
      expect(kills.every((record) => record.data?.attributed)).toBe(true);
      expect(kills.reduce((total, record) => total + (record.data?.experience ?? 0), 0)).toBe(200);
      expect(kills.find((record) => record.data?.mob?.objectId === 902)?.data?.experience).toBe(200);
      expect(rewardRecords.some((record) => record.type === "rewards.unmatched")).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("writes a resolved victim identity before a player-death event", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-death-identity-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
      });
      await coordinator.start();

      capture.packet(authenticatedPacket(1, "test-connection"));
      capture.packet(ownedSpawnPacket(2, 40, 7, "PlayerController"));
      capture.packet(ownedSpawnPacket(3, 140, 7, "HealthComponent"));
      capture.packet(identityPacket(4, 40, "Fallen Aster", "test-connection"));
      capture.packet(monsterIdentityPacket(5, 900));
      const death = damagePacket(6, 140, 900);
      death.rpcName = "Death_C";
      const team = death.decodedFields?.find((field) => field.name === "dmg.Team");
      if (team) team.value = 1;
      capture.packet(death);
      await coordinator.stop();

      const combatPointer = await readCurrentLogStream("combat", directory);
      const combat = records(await readFile(combatPointer!.path, "utf8")) as Array<{
        type: string;
        data?: { kind?: string; actorId?: number; displayName?: string; sourceLabel?: string; targetId?: number };
      }>;
      const identityIndex = combat.findIndex((record) => record.type === "combat.actorIdentity"
        && record.data?.actorId === 140 && record.data.displayName === "Fallen Aster");
      const deathIndex = combat.findIndex((record) => record.type === "combat.event"
        && record.data?.kind === "death" && record.data.targetId === 140);
      const mobIdentityIndex = combat.findIndex((record) => record.type === "combat.event"
        && record.data?.actorId === 900 && record.data.sourceLabel === "Abomination");
      expect(identityIndex).toBeGreaterThan(-1);
      expect(mobIdentityIndex).toBeGreaterThan(-1);
      expect(mobIdentityIndex).toBeLessThan(deathIndex);
      expect(deathIndex).toBeGreaterThan(identityIndex);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("records distinct map IDs as inert combat activations", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-zones-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
      });
      await coordinator.start();
      capture.packet(authenticatedPacket(1, "test-connection"));
      capture.packet(mapPacket(2, 17, "test-connection"));
      capture.packet(mapPacket(3, 17, "test-connection"));
      capture.packet(mapPacket(4, 29, "test-connection"));
      await coordinator.stop();

      const pointer = await readCurrentLogStream("combat", directory);
      const zones = records(await readFile(pointer!.path, "utf8"))
        .filter((record) => record.type === "combat.event")
        .map((record) => (record as { data?: { sourceId?: string } }).data?.sourceId)
        .filter((sourceId): sourceId is string => sourceId?.startsWith("__spiritvaleZone:") ?? false);
      expect(zones).toEqual(["__spiritvaleZone:17", "__spiritvaleZone:29"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("keeps new-connection actor identities when a stale connection trails a map change", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-reconnect-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        diagnosticLogging: true,
      });
      await coordinator.start();

      capture.packet(authenticatedPacket(1_000, "conn-a"));
      capture.packet(identityPacket(1_010, 10, "Alpha", "conn-a"));
      capture.packet(authenticatedPacket(50, "conn-b"));
      capture.packet(identityPacket(60, 20, "Bravo", "conn-b"));
      capture.packet({ tick: 1_200, packetId: 3, packetName: "disconnect", raw: Buffer.alloc(0), payload: Buffer.alloc(0), connectionId: "conn-a" });
      capture.packet(identityPacket(1_210, 30, "Ghost", "conn-a"));
      capture.packet(authenticatedPacket(50, "conn-b"));
      capture.packet({
        tick: 70,
        packetId: 5,
        packetName: "objectSpawn",
        objectId: 40,
        ownerConnectionId: 9,
        spawnSyncPayload: Buffer.from([1, 2, 3, 4]),
        raw: Buffer.alloc(0),
        payload: Buffer.alloc(0),
        connectionId: "conn-b",
      });
      await coordinator.stop();

      const combatPointer = await readCurrentLogStream("combat", directory);
      const combatRecords = records(await readFile(combatPointer!.path, "utf8"));
      const combat = combatRecords
        .filter((record) => record.type === "combat.actorIdentity") as Array<{ type: string; data: { operation: string; displayName?: string } }>;
      expect(combat.map((record) => [record.data.operation, record.data.displayName])).toEqual([
        ["reset", undefined],
        ["upsert", "Alpha"],
        ["reset", undefined],
        ["upsert", "Bravo"],
      ]);

      expect(combatRecords.some((record) => record.type === "combat.spawnIdentityMiss")).toBe(false);

      const otherPointer = await readCurrentLogStream("other", directory);
      const other = records(await readFile(otherPointer!.path, "utf8"));
      expect(other.some((record) => record.type === "fishnet.packet")).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("routes local character callbacks before filtering overlapping connections", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-character-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
      });
      const receivedConnections: string[] = [];
      const internal = coordinator as unknown as {
        character: { consumeBeforeAdmission: (packet: CapturedFishNetPacket) => boolean };
      };
      internal.character.consumeBeforeAdmission = (packet) => {
        if (packet.rpcName !== "CharacterCallback_T") return false;
        receivedConnections.push(packet.connectionId);
        return true;
      };
      await coordinator.start();

      capture.packet(authenticatedPacket(1, "conn-a"));
      capture.packet({
        tick: 2,
        packetId: 1,
        packetName: "rpcLink",
        rpcName: "CharacterCallback_T",
        rpcResolution: "verified",
        raw: Buffer.alloc(0),
        payload: Buffer.alloc(0),
        connectionId: "conn-b",
      });

      expect(receivedConnections).toEqual(["conn-b"]);
      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("filters stale object-bound character packets after a map change", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-character-stale-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
      });
      const internal = coordinator as unknown as {
        character: { physicalObjectId: () => number | undefined };
      };
      await coordinator.start();

      capture.packet(authenticatedPacket(1_000, "conn-a"));
      capture.packet(authenticatedPacket(50, "conn-b"));
      capture.packet({
        tick: 1_010,
        packetId: 1,
        packetName: "serverRpc",
        objectId: 101,
        raw: Buffer.alloc(0),
        payload: Buffer.alloc(0),
        connectionId: "conn-a",
      });
      capture.packet({
        tick: 60,
        packetId: 1,
        packetName: "serverRpc",
        objectId: 202,
        raw: Buffer.alloc(0),
        payload: Buffer.alloc(0),
        connectionId: "conn-b",
      });
      capture.packet({
        tick: 1_020,
        packetId: 1,
        packetName: "rpcLink",
        rpcName: "CharacterCallback_T",
        rpcResolution: "verified",
        raw: Buffer.alloc(0),
        payload: Buffer.alloc(0),
        connectionId: "conn-a",
      });

      expect(internal.character.physicalObjectId()).toBe(202);
      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("keeps character resources across same-object reauthentication", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-character-reauth-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
      });
      await coordinator.start();

      capture.packet(authenticatedPacket(1_000, "conn-a"));
      capture.packet(characterPinPacket(1_001, 202, "conn-a"));
      capture.packet(characterResourcePacket(1_002, 202, "HealthComponent", 750, 1_000, "conn-a"));
      capture.packet(characterResourcePacket(1_003, 202, "SkillsComponent", 120, 240, "conn-a"));
      expect(coordinator.characterState().records).toMatchObject({
        currentHealth: 750,
        maxHealth: 1_000,
        currentMana: 120,
        maxMana: 240,
      });

      capture.packet(authenticatedPacket(1_100, "conn-a"));
      capture.packet(characterPinPacket(1_101, 202, "conn-a"));

      expect(coordinator.characterState().records).toMatchObject({
        currentHealth: 750,
        maxHealth: 1_000,
        currentMana: 120,
        maxMana: 240,
      });

      capture.packet(authenticatedPacket(50, "conn-b"));
      capture.packet(characterPinPacket(51, 202, "conn-b"));
      capture.packet(characterResourcePacket(52, 202, "HealthComponent", 700, 1_000, "conn-b"));

      expect(coordinator.characterState().records).toMatchObject({
        currentHealth: 700,
        maxHealth: 1_000,
        currentMana: 120,
        maxMana: 240,
      });

      capture.packet(authenticatedPacket(25, "conn-c"));
      capture.packet(characterPinPacket(26, 303, "conn-c"));

      // A map can assign a new physical player object without sending an initial resource sync.
      // Keep the previous complete pair until this object emits its first delta.
      expect(coordinator.characterState().records).toMatchObject({
        currentHealth: 700,
        maxHealth: 1_000,
        currentMana: 120,
        maxMana: 240,
      });

      capture.packet(characterResourcePacket(27, 303, "HealthComponent", 650, 1_000, "conn-c"));
      expect(coordinator.characterState().records).toMatchObject({
        currentHealth: 650,
        maxHealth: 1_000,
        currentMana: 120,
        maxMana: 240,
      });
      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("reports capture startup failure without throwing or closing the session", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-failure-"));
    const capture = new FakeCapture(new Error("synthetic capture unavailable"));
    const errorReports: Array<{ title: string; reason: string }> = [];
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        diagnosticLogging: false,
        onError: (report) => errorReports.push(report),
      });
      await coordinator.start();
      expect(coordinator.state()).toEqual({ captureStatus: "unavailable", statusDetail: "Unable to capture data" });
      expect(errorReports).toEqual([{
        title: "Capture could not start",
        reason: "synthetic capture unavailable",
      }]);
      expect(await readCurrentLogStream("combat", directory)).toBeDefined();
      expect(await readCurrentLogStream("rewards", directory)).toBeDefined();
      expect(await readCurrentLogStream("market", directory)).toBeDefined();
      expect(await readCurrentLogStream("other", directory)).toBeUndefined();
      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("restarts capture for a new adapter and rolls back a failed selection", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-adapter-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        deviceName: "fictional-adapter-a",
        captureFactory: () => capture as unknown as PacketCapture,
      });
      await coordinator.start();
      await coordinator.reconfigure("fictional-adapter-b");
      expect(capture.configs.map((config) => config.deviceName)).toEqual(["fictional-adapter-a", "fictional-adapter-b"]);

      capture.failDeviceName = "fictional-adapter-c";
      await expect(coordinator.reconfigure("fictional-adapter-c")).rejects.toThrow("Could not switch capture adapter");
      expect(capture.configs.map((config) => config.deviceName)).toEqual([
        "fictional-adapter-a",
        "fictional-adapter-b",
        "fictional-adapter-c",
        "fictional-adapter-b",
      ]);
      expect(coordinator.state().captureStatus).toBe("capturing");
      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("resetSession rotates combat/rewards/market into one new session, seeding identities and preserving the reward baseline", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-reset-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
      });
      await coordinator.start();

      capture.packet(authenticatedPacket(1, "test-connection"));
      capture.packet(identityPacket(2, 10, "Alpha", "test-connection"));
      capture.packet(experiencePacket(3, 0, 0n));

      const firstCombat = await readCurrentLogStream("combat", directory);
      const firstRewards = await readCurrentLogStream("rewards", directory);
      const firstMarket = await readCurrentLogStream("market", directory);
      expect(firstCombat?.sessionId).toBeDefined();

      await coordinator.resetSession();

      const secondCombat = await readCurrentLogStream("combat", directory);
      const secondRewards = await readCurrentLogStream("rewards", directory);
      const secondMarket = await readCurrentLogStream("market", directory);
      expect(secondCombat?.sessionId).toBeDefined();
      expect(secondCombat?.sessionId).not.toBe(firstCombat?.sessionId);
      expect(new Set([secondCombat?.sessionId, secondRewards?.sessionId, secondMarket?.sessionId]).size).toBe(1);

      const oldCombatRecords = records(await readFile(firstCombat!.path, "utf8"));
      expect(oldCombatRecords.at(-1)).toMatchObject({ type: "combat.lifecycle", data: { state: "stopped" } });
      const oldRewardsRecords = records(await readFile(firstRewards!.path, "utf8"));
      expect(oldRewardsRecords.at(-1)).toMatchObject({ type: "rewards.lifecycle", data: { state: "stopped" } });
      const oldMarketRecords = records(await readFile(firstMarket!.path, "utf8"));
      expect(oldMarketRecords.at(-1)).toMatchObject({ type: "market.lifecycle", data: { state: "stopped" } });

      const newCombatRecords = records(await readFile(secondCombat!.path, "utf8"));
      expect(newCombatRecords[0]).toMatchObject({
        type: "combat.actorIdentity",
        data: { operation: "upsert", actorId: 10, displayName: "Alpha" },
      });
      expect(newCombatRecords.at(-1)).toMatchObject({ type: "combat.lifecycle", data: { state: "started" } });
      const newRewardsRecords = records(await readFile(secondRewards!.path, "utf8"));
      expect(newRewardsRecords[0]).toMatchObject({ type: "rewards.lifecycle", data: { state: "started" } });
      const newMarketRecords = records(await readFile(secondMarket!.path, "utf8"));
      expect(newMarketRecords[0]).toMatchObject({ type: "market.lifecycle", data: { state: "started" } });

      // The reward baseline carried across the boundary: the next XP update computes a gain
      // relative to it instead of silently reseeding with no event.
      capture.packet(experiencePacket(4, 10, 2n));
      await coordinator.stop();
      const rewardsAfter = records(await readFile(secondRewards!.path, "utf8")) as Array<{ type: string; data: { reward?: string } }>;
      const gainRecord = rewardsAfter.find((record) => record.type === "rewards.unmatched");
      expect(gainRecord?.data.reward).toBe("experience");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("coalesces concurrent resetSession calls into a single rotation", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-reset-concurrent-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
      });
      await coordinator.start();
      const firstSessionId = (await readCurrentLogStream("combat", directory))?.sessionId;

      await Promise.all([coordinator.resetSession(), coordinator.resetSession(), coordinator.resetSession()]);

      const sessionFiles = await readdir(path.join(directory, "combat"));
      expect(sessionFiles).toHaveLength(2);
      const secondSessionId = (await readCurrentLogStream("combat", directory))?.sessionId;
      expect(secondSessionId).not.toBe(firstSessionId);

      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rotates the session on a map change once the first authentication is behind it", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-map-change-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        resetOnMapChange: () => true,
      });
      await coordinator.start();
      const loginSessionId = (await readCurrentLogStream("combat", directory))?.sessionId;

      // Logging in is an authentication too, and must not rotate the session it just opened.
      capture.packet(authenticatedPacket(1_000, "conn-a"));
      await settleRotation();
      expect((await readCurrentLogStream("combat", directory))?.sessionId).toBe(loginSessionId);

      // A duplicate of that same authentication is rejected before it can reach the reset.
      capture.packet(authenticatedPacket(1_000, "conn-a"));
      await settleRotation();
      expect((await readCurrentLogStream("combat", directory))?.sessionId).toBe(loginSessionId);

      // A map change opens a new connection; a channel switch re-authenticates on the same one.
      capture.packet(authenticatedPacket(50, "conn-b"));
      const mapChangeSessionId = await waitForSessionChange(directory, loginSessionId);
      expect(mapChangeSessionId).toBeDefined();

      capture.packet(authenticatedPacket(80, "conn-b"));
      expect(await waitForSessionChange(directory, mapChangeSessionId)).toBeDefined();

      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("keeps one session across map changes while the setting is off, and honours it being turned on", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-map-change-off-"));
    const capture = new FakeCapture();
    let resetOnMapChange = false;
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        resetOnMapChange: () => resetOnMapChange,
      });
      await coordinator.start();
      const firstSessionId = (await readCurrentLogStream("combat", directory))?.sessionId;

      capture.packet(authenticatedPacket(1_000, "conn-a"));
      capture.packet(authenticatedPacket(50, "conn-b"));
      await settleRotation();
      expect((await readCurrentLogStream("combat", directory))?.sessionId).toBe(firstSessionId);
      expect(await readdir(path.join(directory, "combat"))).toHaveLength(1);

      // The getter is read per transition, so toggling the setting needs no restart.
      resetOnMapChange = true;
      capture.packet(authenticatedPacket(25, "conn-c"));
      expect(await waitForSessionChange(directory, firstSessionId)).toBeDefined();

      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("leaves the existing session active when replacement session creation fails", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-reset-failure-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
      });
      await coordinator.start();
      const firstSessionId = (await readCurrentLogStream("combat", directory))?.sessionId;

      const internal = coordinator as unknown as { options: { logDirectory: string } };
      const validDirectory = internal.options.logDirectory;
      internal.options.logDirectory = `${validDirectory}${path.sep}in\0valid`;
      await expect(coordinator.resetSession()).rejects.toThrow();
      internal.options.logDirectory = validDirectory;

      expect((await readCurrentLogStream("combat", directory))?.sessionId).toBe(firstSessionId);
      capture.packet(authenticatedPacket(5, "test-connection"));
      expect((await readCurrentLogStream("combat", directory))?.sessionId).toBe(firstSessionId);

      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rolls back already-switched pointers when activation fails partway through", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-reset-partial-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
      });
      await coordinator.start();
      const firstSessionId = (await readCurrentLogStream("combat", directory))?.sessionId;
      expect(firstSessionId).toBeDefined();

      // Streams activate in "combat", "rewards", "market" order; forcing the rewards pointer
      // write to fail (by occupying its target path with a directory) exercises the case where
      // "combat" has already switched over before the rotation as a whole fails.
      const rewardsPointerPath = path.join(directory, "current", "rewards.json");
      await rm(rewardsPointerPath, { force: true });
      await mkdir(rewardsPointerPath);

      await expect(coordinator.resetSession()).rejects.toThrow();

      const combatAfter = await readCurrentLogStream("combat", directory);
      const marketAfter = await readCurrentLogStream("market", directory);
      expect(combatAfter?.sessionId).toBe(firstSessionId);
      expect(marketAfter?.sessionId).toBe(firstSessionId);

      // The old session is still the live one: further packets keep landing in its combat log.
      capture.packet(authenticatedPacket(1, "test-connection"));
      capture.packet(identityPacket(2, 10, "Alpha", "test-connection"));
      await coordinator.stop();
      const combatRecords = records(await readFile(combatAfter!.path, "utf8"));
      expect(combatRecords.some((record) => record.type === "combat.actorIdentity")).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("stop() waits for an in-flight resetSession before tearing the coordinator down", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-reset-stop-race-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
      });
      await coordinator.start();

      const resetPromise = coordinator.resetSession();
      await coordinator.stop();
      await resetPromise;

      expect(coordinator.state()).toMatchObject({ captureStatus: "stopped" });
      // The rotated session was itself fully closed by stop(), not left dangling as "active".
      expect(await readCurrentLogStream("combat", directory)).toBeDefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("resetSession rejects while the coordinator is stopping instead of reviving a session", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-reset-during-stop-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
      });
      await coordinator.start();

      const stopPromise = coordinator.stop();
      await expect(coordinator.resetSession()).rejects.toThrow();
      await stopPromise;

      expect(coordinator.state()).toMatchObject({ captureStatus: "stopped" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  /**
   * The handoff buffer only runs while a session rotation is in flight, which on a fast machine is
   * over before the next packet arrives � so these drive packets across the whole rotation rather
   * than trying to hit the window with one shot. A regression here previously reached CI as a
   * TypeError, because nothing local ever executed the path.
   */
  describe("session handoff buffer", () => {
    test("buffers packets arriving mid-rotation and replays them once it completes", async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-handoff-buffer-"));
      const capture = new FakeCapture();
      try {
        const coordinator = new CaptureCoordinator({
          logDirectory: directory,
          captureFactory: () => capture as unknown as PacketCapture,
          diagnosticLogging: true,
        });
        await coordinator.start();
        capture.packet(authenticatedPacket(1_000, "conn-a"));

        const sentTicks = await sendAcross(coordinator.resetSession(), (tick) => {
          capture.packet(statusPacket(tick, 10, "conn-a"));
        });
        await coordinator.stop();

        const admissions = admissionRecords(await readOtherLog(directory));
        const buffered = admissions.filter((record) => record.decision === "buffered");
        expect(buffered.length).toBeGreaterThan(0);
        expect(buffered.every((record) => record.reason === "capture-session-handoff")).toBe(true);
        expect(sentTicks).toContain(buffered[0]!.tick as number);

        // Buffering must defer a packet, not discard it: every buffered tick is admitted again
        // once the rotation drains the buffer.
        const acceptedTicks = new Set(admissions.filter((record) => record.decision === "accepted").map((record) => record.tick));
        for (const record of buffered) expect(acceptedTicks.has(record.tick)).toBe(true);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    test("fails the rotation and stops capture when buffered packets exceed the byte limit", async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-handoff-overflow-"));
      const capture = new FakeCapture();
      const errorReports: Array<{ title: string; reason: string }> = [];
      try {
        const coordinator = new CaptureCoordinator({
          logDirectory: directory,
          captureFactory: () => capture as unknown as PacketCapture,
          onError: (report) => errorReports.push(report),
        });
        await coordinator.start();
        capture.packet(authenticatedPacket(1_000, "conn-a"));

        // One packet larger than the 16MB budget overflows the buffer on its own. The same branch
        // guards the 4096-packet cap, which is impractical to reach through a real rotation window.
        const oversized = Buffer.alloc(16 * 1024 * 1024 + 1);
        let rejection: unknown;
        const rotation = coordinator.resetSession().catch((error: unknown) => { rejection = error; });
        await sendAcross(rotation, (tick) => {
          capture.packet({ ...statusPacket(tick, 10, "conn-a"), raw: oversized, payload: oversized });
        });

        expect(errorMessageOf(rejection)).toContain("exceeded its bounded packet buffer");
        expect(errorReports.map((report) => report.title)).toContain("Capture session reset could not keep up with incoming data");
        expect(errorReports.some((report) => report.reason.includes("exceeded its bounded packet buffer"))).toBe(true);
        expect(coordinator.state()).toMatchObject({ captureStatus: "unavailable" });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  });

  test("creates a fresh session and restores error handling after a full restart", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-restart-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
      });
      await coordinator.start();
      const firstSession = (await readCurrentLogStream("combat", directory))?.sessionId;
      await coordinator.stop();

      await coordinator.start();
      const secondSession = (await readCurrentLogStream("combat", directory))?.sessionId;
      expect(secondSession).toBeDefined();
      expect(secondSession).not.toBe(firstSession);

      capture.fail(new Error("synthetic capture failure"));
      expect(coordinator.state()).toMatchObject({ captureStatus: "unavailable" });
      await coordinator.stop();
      expect(coordinator.state()).toMatchObject({ captureStatus: "stopped" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

/**
 * Fires a packet on every tick until `rotation` settles, so packets land throughout the handoff
 * window rather than depending on a single well-timed shot. Returns the ticks it sent.
 */
async function sendAcross(rotation: Promise<unknown>, send: (tick: number) => void): Promise<number[]> {
  const ticks: number[] = [];
  let settled = false;
  const tracked = rotation.finally(() => { settled = true; });
  for (let tick = 2_000; !settled && tick < 2_400; tick += 1) {
    send(tick);
    ticks.push(tick);
    await Bun.sleep(0);
  }
  await tracked;
  return ticks;
}

async function readOtherLog(directory: string): Promise<Array<{ type: string; data: Record<string, unknown> }>> {
  const pointer = await readCurrentLogStream("other", directory);
  if (!pointer) return [];
  return records(await readFile(pointer.path, "utf8")) as Array<{ type: string; data: Record<string, unknown> }>;
}

function admissionRecords(all: Array<{ type: string; data: Record<string, unknown> }>): Array<Record<string, unknown>> {
  return all.filter((record) => record.type === "capture.packetAdmission").map((record) => record.data);
}

function errorMessageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

class FakeCapture extends EventEmitter {
  readonly configs: CaptureConfig[] = [];
  failDeviceName?: string;
  initialTargetState: "waiting" | "active" = "waiting";
  constructor(private readonly startError?: Error) { super(); }

  async start(config: CaptureConfig): Promise<void> {
    this.configs.push(config);
    if (this.startError) throw this.startError;
    if (this.failDeviceName !== undefined && config.deviceName === this.failDeviceName) throw new Error("synthetic adapter unavailable");
    this.target(this.initialTargetState, this.initialTargetState === "active" ? [4242] : []);
    this.emit("started");
  }

  async stop(): Promise<void> {
    this.emit("stopped");
  }

  /**
   * `liteNetPacket` is not optional on a real captured packet, and the handoff buffer sizes packets
   * from it. Synthesizing one here keeps the fake honest: a packet arriving mid-rotation is buffered
   * rather than crashing on a field the fixture forgot to carry.
   */
  packet(packet: TestPacket): void {
    const captured: CapturedFishNetPacket = {
      connectionId: "test-connection",
      liteNetPacket: liteNetPacket(new Date(), packet.raw),
      ...packet,
    };
    this.emit("fishNetPacket", captured);
  }

  liteNet(packet: CapturedLiteNetLibPacket): void {
    this.emit("liteNetPacket", packet);
  }

  fail(error: Error): void {
    this.emit("error", error);
  }

  target(state: "waiting" | "active", processIds: number[] = []): void {
    this.emit("targetStatus", { processName: "SpiritVale.exe", state, processIds });
  }
}

type TestPacket = Omit<CapturedFishNetPacket, "liteNetPacket" | "connectionId"> & { connectionId?: string };

/**
 * A map-change rotation is started from the packet handler and cannot be awaited by the caller, so
 * both helpers give it room to run: one waits for the new session pointer, the other waits long
 * enough that a rotation which should not have happened would have shown up.
 */
async function waitForSessionChange(directory: string, previousSessionId: string | undefined): Promise<string | undefined> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const pointer = await readCurrentLogStream("combat", directory);
    if (pointer?.sessionId && pointer.sessionId !== previousSessionId) return pointer.sessionId;
    await Bun.sleep(10);
  }
  return undefined;
}

async function settleRotation(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) await Bun.sleep(10);
}

/** Every stream file opens with a self-describing header line, which is not a record. */
function records(content: string): Array<{ type: string }> {
  return content.trim().split(/\r?\n/).filter(Boolean)
    .map((line) => JSON.parse(line) as unknown)
    .filter((entry) => !isLogStreamHeader(entry)) as Array<{ type: string }>;
}

function experiencePacket(tick: number, experience: number, coins: bigint): TestPacket {
  const payload = Buffer.concat([packed(experience), packed(1), packed(0), packed(1), packed(coins)]);
  return { tick, packetId: 4, packetName: "targetRpc", rpcName: "ExpCoinsChanged_T", raw: payload, payload };
}

function marketListingPacket(tick: number): TestPacket {
  const listingsJson = JSON.stringify([{
    ListingId: "listing-a",
    SellerAccountId: "seller-a",
    SellerDisplayName: "Merchant Alpha",
    ItemDisplayName: "Fictional Blade",
    Item: { ItemId: "fictional-blade", Type: 1, Quantity: 3, PayloadJson: "{}" },
    AvailableQuantity: 3,
    SoldQuantity: 1,
    UnitPrice: "2500",
    ExpiresAt: "2100-01-01T00:00:00Z",
  }]);
  return {
    tick,
    packetId: 1,
    packetName: "rpcLink",
    rpcName: "RequestVendorItemList_T",
    rpcResolution: "verified",
    networkBehaviourType: "PlayerController",
    decodedFields: [{ name: "listingsJson", codec: "stringUtf8Packed", value: listingsJson }],
    raw: Buffer.from([1]),
    payload: Buffer.from([1]),
  };
}

function authenticatedPacket(tick: number, connectionId: string): TestPacket {
  return { tick, packetId: 0, packetName: "authenticated", raw: Buffer.alloc(0), payload: Buffer.alloc(0), connectionId };
}

function statusPacket(tick: number, objectId: number, connectionId: string): TestPacket {
  return {
    tick,
    packetId: 1,
    packetName: "targetRpc",
    objectId,
    rpcName: "ApplyEffect_T",
    rpcResolution: "verified",
    networkBehaviourType: "StatusComponent",
    decodedFields: [
      { name: "statusId", codec: "stringUtf8Packed", value: "Haste" },
      { name: "level", codec: "packedInt32", value: 1 },
    ],
    raw: Buffer.from([1, 2]),
    payload: Buffer.from([1, 2]),
    connectionId,
  };
}

function liteNetPacket(capturedAt: Date, raw: Buffer): CapturedLiteNetLibPacket {
  return {
    mergePath: [],
    packet: {
      propertyId: 1,
      property: "channeled",
      connectionNumber: 0,
      fragmented: false,
      sequence: 1,
      channel: 0,
      raw,
      payload: raw,
    },
    udpPacket: {
      timestampTicks: 0n,
      capturedAt,
      interfaceIndex: 1,
      subinterfaceIndex: 0,
      direction: "inbound",
      loopback: false,
      ipVersion: 4,
      sourceIP: "127.0.0.1",
      destinationIP: "127.0.0.1",
      sourcePort: 7000,
      destinationPort: 7001,
      truncated: false,
      payload: raw,
      protocol: "udp",
    },
  };
}

function characterPinPacket(tick: number, objectId: number, connectionId: string): TestPacket {
  return {
    tick,
    packetId: 1,
    packetName: "serverRpc",
    objectId,
    networkBehaviourType: "HealthComponent",
    raw: Buffer.alloc(0),
    payload: Buffer.alloc(0),
    connectionId,
  };
}

function characterResourcePacket(
  tick: number,
  objectId: number,
  networkBehaviourType: "HealthComponent" | "SkillsComponent",
  current: number,
  maximum: number,
  connectionId: string,
): TestPacket {
  const payload = Buffer.concat([Buffer.from([0]), packed(current), Buffer.from([1]), packed(maximum)]);
  return {
    tick,
    packetId: 7,
    packetName: "syncType",
    objectId,
    networkBehaviourType,
    raw: payload,
    payload,
    connectionId,
  };
}

function identityPacket(tick: number, objectId: number, displayName: string, connectionId: string): TestPacket {
  return {
    tick,
    packetId: 7,
    packetName: "syncType",
    objectId,
    networkBehaviourType: "PlayerController",
    syncName: "VisualData",
    decodedFields: [{ name: "Appearance.DisplayName", typeName: "System.String", codec: "stringUtf8Packed", value: displayName }],
    raw: Buffer.alloc(0),
    payload: Buffer.alloc(0),
    connectionId,
  };
}

function ownedSpawnPacket(
  tick: number,
  objectId: number,
  ownerConnectionId: number,
  networkBehaviourType: string,
): TestPacket {
  return {
    tick,
    packetId: 5,
    packetName: "objectSpawn",
    objectId,
    ownerConnectionId,
    rpcLinkRegistrations: [{
      linkId: 900 + objectId,
      objectId,
      componentIndex: 0,
      rpcHash: 1,
      packetName: "observersRpc",
      networkBehaviourType,
    }],
    raw: Buffer.alloc(0),
    payload: Buffer.alloc(0),
  };
}

function damagePacket(tick: number, targetId: number, actorId: number): TestPacket {
  return {
    tick,
    packetId: 900,
    packetName: "rpcLink",
    objectId: targetId,
    rpcName: "ApplyDamage_C",
    networkBehaviourType: "HealthComponent",
    decodedFields: [
      { name: "dmg.Team", codec: "packedInt32", value: 0 },
      { name: "dmg.Value", codec: "packedInt32", value: 100 },
      { name: "dmg.Type", codec: "packedInt32", value: 0 },
      { name: "dmg.Hit", codec: "packedInt32", value: 0 },
      { name: "dmg.Hits", codec: "packedInt32", value: 1 },
      { name: "dmg.DamageSourceId", codec: "stringUtf8Packed", value: "SyntheticArc" },
      { name: "dmg.AttackerId", codec: "packedInt32", value: actorId },
      { name: "dmg.IsClone", codec: "boolean", value: false },
      { name: "dmg.IsSummon", codec: "boolean", value: false },
      { name: "dmg.Element", codec: "packedInt32", value: 0 },
      { name: "dmg.WeaponType", codec: "packedInt32", value: 4 },
      { name: "dmg.Range", codec: "packedInt32", value: 2 },
      { name: "position", codec: "vector3", value: [1, 2, 3] },
      { name: "origin", codec: "vector3", value: [4, 5, 6] },
    ],
    raw: Buffer.alloc(0),
    payload: Buffer.alloc(0),
  };
}

function recoverPacket(tick: number, targetId: number, amount: number): TestPacket {
  return {
    tick,
    packetId: 902,
    packetName: "rpcLink",
    objectId: targetId,
    rpcName: "Recover_C",
    networkBehaviourType: "HealthComponent",
    decodedFields: [{ name: "amount", codec: "packedInt32", value: amount }],
    undecodedPayload: Buffer.from("0001ab020000403f", "hex"),
    raw: Buffer.alloc(0),
    payload: Buffer.alloc(0),
  };
}

function monsterIdentityPacket(tick: number, objectId: number): TestPacket {
  return {
    tick,
    packetId: 901,
    packetName: "syncType",
    objectId,
    networkBehaviourType: "MonsterController",
    decodedFields: [
      { name: "Data.Id", codec: "stringUtf8Packed", value: "Abomination" },
      { name: "Data.Level", codec: "packedInt32", value: 60 },
    ],
    raw: Buffer.alloc(0),
    payload: Buffer.alloc(0),
  };
}

function mapPacket(tick: number, mapId: number, connectionId: string): TestPacket {
  return {
    tick,
    packetId: 900,
    packetName: "rpcLink",
    rpcName: "TraverseActive",
    decodedFields: [{ name: "mapId", codec: "packedInt32", value: mapId }],
    raw: Buffer.alloc(0),
    payload: Buffer.alloc(0),
    connectionId,
  };
}

function syntheticCachedCharacter(): CharacterSnapshot {
  return {
    schemaVersion: 1,
    buildFingerprint: "synthetic-build",
    name: "Fictional Hero",
    archetypes: ["Warrior", "Berserker"],
    level: 42,
    experience: 0,
    jobLevel: 18,
    jobExperience: 0,
    attributes: { STR: 60, VIT: 30, AGI: 10, DEX: 20, INT: 5, LUK: 15 },
    activeLoadout: "Normal",
    equipment: [],
    artifacts: [],
    skills: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "cached",
  };
}

function packed(value: number | bigint): Buffer {
  const signed = BigInt(value);
  let encoded = (signed << 1n) ^ (signed >> 63n);
  const bytes: number[] = [];
  while (encoded >= 0x80n) {
    bytes.push(Number(encoded & 0x7fn) | 0x80);
    encoded >>= 7n;
  }
  bytes.push(Number(encoded));
  return Buffer.from(bytes);
}
