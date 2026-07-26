import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CharacterSnapshot } from "@kar-mi/spirit-vale-tools-character";
import { DpsSessionLogFollower } from "@kar-mi/spirit-vale-tools-combat";
import type { CapturedFishNetPacket, CaptureConfig } from "@kar-mi/spirit-vale-tools-capture";
import type { PacketCapture } from "@kar-mi/spirit-vale-tools-capture/capture";
import { readCurrentLogStream } from "@kar-mi/spirit-vale-tools-logging";
import { MarketSessionLogFollower } from "@kar-mi/spirit-vale-tools-market";
import { RewardSessionLogFollower } from "@kar-mi/spirit-vale-tools-rewards";

import { CaptureCoordinator } from "./capture-coordinator.ts";

describe("central capture coordinator", () => {
  test("reports game and data activity after target status arrives before capture startup", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-status-"));
    const capture = new FakeCapture();
    capture.initialTargetState = "active";
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
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
      capture.packet({
        tick: 4,
        packetId: 1,
        packetName: "rpcLink",
        rpcName: "VendingCollectResult_T",
        rpcResolution: "verified",
        networkBehaviourType: "PlayerController",
        raw: Buffer.from([1]),
        payload: Buffer.from([1]),
      });
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
      capture.packet({
        tick: 4,
        packetId: 1,
        packetName: "rpcLink",
        rpcName: "VendingCollectResult_T",
        rpcResolution: "verified",
        networkBehaviourType: "PlayerController",
        raw: Buffer.from([1]),
        payload: Buffer.from([1]),
      });
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

      const combat = await new DpsSessionLogFollower(directory).poll();
      const rewards = await new RewardSessionLogFollower(directory).poll();
      const market = await new MarketSessionLogFollower(directory).poll();
      expect(new Set([combat.sessionId, rewards.sessionId, market.sessionId]).size).toBe(1);
      expect(combat.events.length).toBeGreaterThan(0);
      expect(rewards.snapshot.unmatched).toBeGreaterThan(0);
      expect(market).toMatchObject({ missing: false, status: "stopped" });
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
        character: { consume: (packet: CapturedFishNetPacket) => boolean };
      };
      internal.character.consume = (packet) => {
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

  test("reports capture startup failure without throwing or closing the session", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-failure-"));
    const capture = new FakeCapture(new Error("synthetic capture unavailable"));
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
      });
      await coordinator.start();
      expect(coordinator.state()).toEqual({ captureStatus: "unavailable", statusDetail: "Unable to capture data" });
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

      const sessionDirectories = await readdir(path.join(directory, "sessions"));
      expect(sessionDirectories).toHaveLength(2);
      const secondSessionId = (await readCurrentLogStream("combat", directory))?.sessionId;
      expect(secondSessionId).not.toBe(firstSessionId);

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

  packet(packet: TestPacket): void {
    this.emit("fishNetPacket", { connectionId: "test-connection", ...packet } as CapturedFishNetPacket);
  }

  fail(error: Error): void {
    this.emit("error", error);
  }

  target(state: "waiting" | "active", processIds: number[] = []): void {
    this.emit("targetStatus", { processName: "SpiritVale.exe", state, processIds });
  }
}

type TestPacket = Omit<CapturedFishNetPacket, "liteNetPacket" | "connectionId"> & { connectionId?: string };

function records(content: string): Array<{ type: string }> {
  return content.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { type: string });
}

function experiencePacket(tick: number, experience: number, coins: bigint): TestPacket {
  const payload = Buffer.concat([packed(experience), packed(1), packed(0), packed(1), packed(coins)]);
  return { tick, packetId: 4, packetName: "targetRpc", rpcName: "ExpCoinsChanged_T", raw: payload, payload };
}

function authenticatedPacket(tick: number, connectionId: string): TestPacket {
  return { tick, packetId: 0, packetName: "authenticated", raw: Buffer.alloc(0), payload: Buffer.alloc(0), connectionId };
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
