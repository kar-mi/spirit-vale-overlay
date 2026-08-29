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
import { RewardSessionLogFollower } from "@kar-mi/spirit-vale-tools-rewards";

import { CaptureCoordinator } from "./capture-coordinator.ts";

describe("central capture coordinator", () => {
  test("identifies the deepest stalled capture stage without recording packet contents", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-health-"));
    const capture = new FakeCapture();
    capture.initialTargetState = "active";
    const states: ReturnType<CaptureCoordinator["state"]>[] = [];
    const reports: Array<{ title: string; reason: string; details?: Readonly<Record<string, unknown>> }> = [];
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        stallWarningMs: 5,
        onStatus: (state) => states.push(state),
        onWarning: (report) => reports.push(report),
      });
      await coordinator.start();

      capture.udp(liteNetPacket(new Date(), Buffer.from("udp-only")).udpPacket);
      await Bun.sleep(15);
      expect(coordinator.state().captureWarning?.code).toBe("unrecognized-game-udp");

      capture.liteNet(liteNetPacket(new Date(), Buffer.from("litenet-only")));
      expect(coordinator.state().captureWarning).toBeUndefined();
      await Bun.sleep(15);
      expect(coordinator.state().captureWarning?.code).toBe("fishnet-decode-stalled");

      capture.packet(authenticatedPacket(1, "test-connection"));
      expect(coordinator.state()).toMatchObject({ captureStatus: "capturing", statusDetail: "Capture Active" });
      expect(coordinator.state().captureWarning).toBeUndefined();

      expect(reports.map((report) => report.details?.["Capture stage"])).toEqual(["udp", "litenet"]);
      expect(JSON.stringify(reports)).not.toContain("udp-only");
      expect(JSON.stringify(reports)).not.toContain("litenet-only");
      expect(states.some((state) => state.captureWarning?.code === "fishnet-decode-stalled")).toBe(true);
      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("warns when a detected game produces no target-owned UDP", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-no-udp-"));
    const capture = new FakeCapture();
    capture.initialTargetState = "active";
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        stallWarningMs: 5,
      });
      await coordinator.start();
      await Bun.sleep(15);
      expect(coordinator.state().captureWarning?.code).toBe("no-game-udp");
      capture.packet(authenticatedPacket(1, "test-connection"));
      expect(coordinator.state().captureWarning).toBeUndefined();
      await Bun.sleep(15);
      expect(coordinator.state().captureWarning?.code).toBe("fishnet-data-delayed");
      capture.packet(authenticatedPacket(2, "test-connection"));
      expect(coordinator.state().captureWarning).toBeUndefined();
      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("reports a missing game once until it has been detected again", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-missing-game-"));
    const capture = new FakeCapture();
    const errorReports: Array<{ title: string; reason: string; details?: Readonly<Record<string, unknown>> }> = [];
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        stallWarningMs: 5,
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
    const warningReports: Array<{ title: string; reason: string; details?: Readonly<Record<string, unknown>> }> = [];
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        stallWarningMs: 5,
        onError: (report) => errorReports.push(report),
        onWarning: (report) => warningReports.push(report),
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
      await Bun.sleep(15);
      expect(errorReports.map((report) => report.title)).toEqual(["Game was not detected for capture"]);
      expect(warningReports.map((report) => report.title)).toEqual(["Capture is still waiting for usable game data"]);
      expect(warningReports[0]).toMatchObject({
        reason: expect.stringContaining("Capture remains active"),
        details: {
          "Capture stage": "waiting",
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
      capture.packet({ tick: 5, packetId: 2, packetName: "pingPong", raw: Buffer.alloc(0), payload: Buffer.alloc(0) });
      await coordinator.stop();

      const pointers = await Promise.all(["combat", "rewards", "other"].map((stream) => {
        return readCurrentLogStream(stream as "combat" | "rewards" | "other", directory);
      }));
      expect(new Set(pointers.map((pointer) => pointer?.sessionId)).size).toBe(1);
      expect(pointers.every((pointer) => pointer !== undefined)).toBe(true);

      const streams = await Promise.all(pointers.map(async (pointer) => {
        return records(await readFile(pointer!.path, "utf8"));
      }));
      const combat = streams[0]!;
      const rewards = streams[1]!;
      const other = streams[2]!;
      expect(combat.map((record) => record.type)).toContain("combat.actorIdentity");
      expect(rewards.map((record) => record.type)).toContain("rewards.unmatched");
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

  test("captures both domains before their log followers are opened", async () => {
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

      const combatFollower = new DpsSessionLogFollower(directory);
      const rewardsFollower = new RewardSessionLogFollower(directory);
      const combat = await combatFollower.poll();
      const rewards = await rewardsFollower.poll();
      combatFollower.close();
      rewardsFollower.close();
      expect(new Set([combat.sessionId, rewards.sessionId]).size).toBe(1);
      expect(combat.events.length).toBeGreaterThan(0);
      expect(rewards.snapshot.unmatched).toBeGreaterThan(0);
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

  test("records tower floors as zones and returns to the latest physical map on exit", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-tower-zones-"));
    const capture = new FakeCapture();
    let goldResets = 0;
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        resetOnMapChange: () => false,
        onGoldMapChange: () => { goldResets += 1; },
      });
      await coordinator.start();

      capture.packet(authenticatedPacket(1, "tower-connection"));
      capture.packet(mapPacket(2, 17, "tower-connection"));
      capture.packet(towerFloorPacket(3, 1, "tower-connection"));
      await Bun.sleep(550);
      capture.packet(mapPacket(4, 29, "tower-connection"));
      capture.packet(towerFloorPacket(5, 2, "tower-connection"));
      await Bun.sleep(550);
      capture.packet(towerExitPacket(6, "tower-connection"));
      capture.packet(towerExitPacket(7, "tower-connection"));
      await Bun.sleep(550);
      await coordinator.stop();

      const pointer = await readCurrentLogStream("combat", directory);
      const locations = records(await readFile(pointer!.path, "utf8"))
        .filter((record) => record.type === "combat.event")
        .map((record) => (record as { data?: { sourceId?: string; sourceLabel?: string } }).data)
        .filter((data) => data?.sourceId?.startsWith("__spiritvaleZone:")
          || data?.sourceId?.startsWith("__spiritvaleTowerFloor:"))
        .map((data) => ({ sourceId: data?.sourceId, sourceLabel: data?.sourceLabel }));
      expect(locations).toEqual([
        { sourceId: "__spiritvaleZone:17", sourceLabel: "Zone 17" },
        { sourceId: "__spiritvaleTowerFloor:1", sourceLabel: "Eternal Tower - Floor 1" },
        { sourceId: "__spiritvaleTowerFloor:2", sourceLabel: "Eternal Tower - Floor 2" },
        { sourceId: "__spiritvaleZone:29", sourceLabel: "Zone 29" },
      ]);
      expect(goldResets).toBe(3);
      expect(await readdir(path.join(directory, "combat"))).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("coalesces an exit-entry-floor burst into one session seeded with the final floor", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-tower-reset-"));
    const capture = new FakeCapture();
    let goldResets = 0;
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        resetOnMapChange: () => true,
        onGoldMapChange: () => { goldResets += 1; },
      });
      await coordinator.start();
      capture.packet(authenticatedPacket(1, "tower-connection"));
      capture.packet(mapPacket(2, 17, "tower-connection"));
      const previousSessionId = (await readCurrentLogStream("combat", directory))?.sessionId;

      capture.packet(towerExitPacket(3, "tower-connection"));
      capture.packet(towerFloorPacket(4, 1, "tower-connection"));
      capture.packet(towerFloorPacket(5, 2, "tower-connection"));
      capture.packet({ ...damagePacket(6, 900, 41), connectionId: "tower-connection" });

      const towerSessionId = await waitForSessionChange(directory, previousSessionId);
      expect(towerSessionId).toBeDefined();
      await Bun.sleep(100);
      capture.packet(towerFloorPacket(7, 2, "tower-connection"));
      await Bun.sleep(550);
      expect((await readCurrentLogStream("combat", directory))?.sessionId).toBe(towerSessionId);
      await coordinator.stop();

      const pointer = await readCurrentLogStream("combat", directory);
      const combat = records(await readFile(pointer!.path, "utf8")) as Array<{
        type: string;
        data?: { sourceId?: string; actorId?: number };
      }>;
      expect(combat.filter((record) => record.data?.sourceId?.startsWith("__spiritvale"))
        .map((record) => record.data?.sourceId)).toEqual(["__spiritvaleTowerFloor:2"]);
      expect(combat.some((record) => record.type === "combat.event" && record.data?.actorId === 41)).toBe(true);
      expect(goldResets).toBe(1);
      expect(await readdir(path.join(directory, "combat"))).toHaveLength(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("preserves actor identities and creates only the floor session across same-connection reauthentication", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-tower-reauth-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        diagnosticLogging: true,
        resetOnMapChange: () => true,
      });
      await coordinator.start();

      capture.packet(authenticatedPacket(1, "tower-connection"));
      capture.packet(mapPacket(2, 17, "tower-connection"));
      capture.packet(identityPacket(3, 123, "John", "tower-connection"));
      const previousSessionId = (await readCurrentLogStream("combat", directory))?.sessionId;

      capture.packet(towerFloorPacket(4, 1, "tower-connection"));
      capture.packet(authenticatedPacket(5, "tower-connection"));
      capture.packet({ ...damagePacket(6, 900, 123), connectionId: "tower-connection" });
      capture.packet(identityPacket(7, 123, "Jane", "tower-connection"));

      const towerSessionId = await waitForSessionChange(directory, previousSessionId);
      expect(towerSessionId).toBeDefined();
      await settleRotation();
      expect((await readCurrentLogStream("combat", directory))?.sessionId).toBe(towerSessionId);
      await coordinator.stop();

      expect(await readdir(path.join(directory, "combat"))).toHaveLength(2);
      const combatPointer = await readCurrentLogStream("combat", directory);
      const combat = records(await readFile(combatPointer!.path, "utf8")) as Array<{
        type: string;
        data?: { operation?: string; actorId?: number; displayName?: string; sourceId?: string };
      }>;
      const identityIndex = combat.findIndex((record) => record.type === "combat.actorIdentity"
        && record.data?.operation === "upsert"
        && record.data.actorId === 123
        && record.data.displayName === "John");
      const damageIndex = combat.findIndex((record) => record.type === "combat.event"
        && record.data?.actorId === 123);
      expect(identityIndex).toBeGreaterThan(-1);
      expect(damageIndex).toBeGreaterThan(identityIndex);
      expect(combat).toContainEqual(expect.objectContaining({
        type: "combat.actorIdentity",
        data: expect.objectContaining({ operation: "upsert", actorId: 123, displayName: "Jane" }),
      }));
      expect(combat.some((record) => record.type === "combat.actorIdentity"
        && record.data?.operation === "reset")).toBe(false);
      expect(loggedLocations(await readFile(combatPointer!.path, "utf8"))).toEqual([
        "__spiritvaleTowerFloor:1",
      ]);

      const other = await readOtherLogs(directory);
      expect(admissionRecords(other)).toContainEqual(expect.objectContaining({
        decision: "rejected",
        reason: "same-connection-reauthenticated",
        packetConnectionId: "tower-connection",
        tick: 5,
      }));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("clears the tower floor when the next map authenticates on a new connection", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-tower-switch-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        resetOnMapChange: () => false,
      });
      await coordinator.start();

      capture.packet(authenticatedPacket(1, "tower-a"));
      capture.packet(mapPacket(2, 17, "tower-a"));
      capture.packet(towerFloorPacket(3, 1, "tower-a"));
      await Bun.sleep(550);
      capture.packet(authenticatedPacket(4, "tower-b"));
      capture.packet(mapPacket(5, 29, "tower-b"));
      await Bun.sleep(50);
      await coordinator.stop();

      const pointer = await readCurrentLogStream("combat", directory);
      expect(loggedLocations(await readFile(pointer!.path, "utf8"))).toEqual([
        "__spiritvaleZone:17",
        "__spiritvaleTowerFloor:1",
        "__spiritvaleZone:29",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rotates on a manual reset while the replacement location is still unknown", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-tower-manual-reset-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        resetOnMapChange: () => false,
      });
      await coordinator.start();

      capture.packet(authenticatedPacket(1, "tower-a"));
      capture.packet(mapPacket(2, 17, "tower-a"));
      capture.packet(towerFloorPacket(3, 1, "tower-a"));
      await Bun.sleep(550);
      const previousSessionId = (await readCurrentLogStream("combat", directory))?.sessionId;

      capture.packet(authenticatedPacket(4, "tower-b"));
      capture.packet(towerExitPacket(5, "tower-b"));
      await Bun.sleep(50);
      await coordinator.resetSession();
      expect((await readCurrentLogStream("combat", directory))?.sessionId).not.toBe(previousSessionId);

      await coordinator.stop();
      expect(await readdir(path.join(directory, "combat"))).toHaveLength(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("logs a pending floor on shutdown without resetting the gold tracker", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-tower-shutdown-"));
    const capture = new FakeCapture();
    let goldResets = 0;
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        resetOnMapChange: () => false,
        onGoldMapChange: () => { goldResets += 1; },
      });
      await coordinator.start();

      capture.packet(authenticatedPacket(1, "tower-a"));
      capture.packet(mapPacket(2, 17, "tower-a"));
      capture.packet(towerFloorPacket(3, 1, "tower-a"));
      await coordinator.stop();

      const pointer = await readCurrentLogStream("combat", directory);
      expect(loggedLocations(await readFile(pointer!.path, "utf8"))).toEqual([
        "__spiritvaleZone:17",
        "__spiritvaleTowerFloor:1",
      ]);
      expect(goldResets).toBe(0);
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
      expect(await readCurrentLogStream("other", directory)).toBeUndefined();
      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("restarts capture for a new adapter and rolls back a failed selection", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-adapter-"));
    const capture = new FakeCapture();
    capture.initialTargetState = "active";
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        deviceName: "fictional-adapter-a",
        captureFactory: () => capture as unknown as PacketCapture,
        stallWarningMs: 5,
      });
      await coordinator.start();
      await coordinator.reconfigure("fictional-adapter-b");
      expect(capture.configs.map((config) => config.deviceName)).toEqual(["fictional-adapter-a", "fictional-adapter-b"]);
      await Bun.sleep(15);
      expect(coordinator.state().captureWarning?.code).toBe("no-game-udp");

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

  test("resetSession rotates combat/rewards into one new session, seeding identities and preserving the reward baseline", async () => {
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
      expect(firstCombat?.sessionId).toBeDefined();

      await coordinator.resetSession();

      const secondCombat = await readCurrentLogStream("combat", directory);
      const secondRewards = await readCurrentLogStream("rewards", directory);
      expect(secondCombat?.sessionId).toBeDefined();
      expect(secondCombat?.sessionId).not.toBe(firstCombat?.sessionId);
      expect(new Set([secondCombat?.sessionId, secondRewards?.sessionId]).size).toBe(1);

      const oldCombatRecords = records(await readFile(firstCombat!.path, "utf8"));
      expect(oldCombatRecords.at(-1)).toMatchObject({ type: "combat.lifecycle", data: { state: "stopped" } });
      const oldRewardsRecords = records(await readFile(firstRewards!.path, "utf8"));
      expect(oldRewardsRecords.at(-1)).toMatchObject({ type: "rewards.lifecycle", data: { state: "stopped" } });

      const newCombatRecords = records(await readFile(secondCombat!.path, "utf8"));
      expect(newCombatRecords[0]).toMatchObject({
        type: "combat.actorIdentity",
        data: { operation: "upsert", actorId: 10, displayName: "Alpha" },
      });
      expect(newCombatRecords.at(-1)).toMatchObject({ type: "combat.lifecycle", data: { state: "started" } });
      const newRewardsRecords = records(await readFile(secondRewards!.path, "utf8"));
      expect(newRewardsRecords[0]).toMatchObject({ type: "rewards.lifecycle", data: { state: "started" } });

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

      capture.packet(authenticatedPacket(1_000, "conn-a"));
      await settleRotation();
      expect((await readCurrentLogStream("combat", directory))?.sessionId).toBe(loginSessionId);

      capture.packet(authenticatedPacket(1_000, "conn-a"));
      await settleRotation();
      expect((await readCurrentLogStream("combat", directory))?.sessionId).toBe(loginSessionId);

      capture.packet(authenticatedPacket(50, "conn-b"));
      const mapChangeSessionId = await waitForSessionChange(directory, loginSessionId);
      expect(mapChangeSessionId).toBeDefined();

      capture.packet(authenticatedPacket(80, "conn-b"));
      await settleRotation();
      expect((await readCurrentLogStream("combat", directory))?.sessionId).toBe(mapChangeSessionId);

      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("treats the first authentication as a map change when capture attached to an active session", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-attached-map-change-"));
    const capture = new FakeCapture();
    let goldResets = 0;
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        resetOnMapChange: () => true,
        onGoldMapChange: () => { goldResets += 1; },
      });
      await coordinator.start();

      capture.packet(mapPacket(1_000, 29, "conn-a"));
      const attachedSessionId = (await readCurrentLogStream("combat", directory))?.sessionId;

      capture.packet(authenticatedPacket(50, "conn-b"));
      capture.packet(mapPacket(55, 48, "conn-b"));
      expect(await waitForSessionChange(directory, attachedSessionId)).toBeDefined();
      await coordinator.stop();

      const pointer = await readCurrentLogStream("combat", directory);
      const zones = records(await readFile(pointer!.path, "utf8"))
        .filter((record) => record.type === "combat.event")
        .map((record) => (record as { data?: { sourceId?: string } }).data?.sourceId)
        .filter((sourceId): sourceId is string => sourceId?.startsWith("__spiritvaleZone:") ?? false);
      expect(zones).toEqual(["__spiritvaleZone:48"]);
      expect(goldResets).toBe(1);
      expect(await readdir(path.join(directory, "combat"))).toHaveLength(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("replays a new-connection identity into an automatic map-change session", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-map-change-identities-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        resetOnMapChange: () => true,
      });
      await coordinator.start();

      capture.packet(authenticatedPacket(1_000, "conn-a"));
      capture.packet(identityPacket(1_010, 40, "Aster Vale", "conn-a"));
      const previousSessionId = (await readCurrentLogStream("combat", directory))?.sessionId;

      capture.packet(authenticatedPacket(50, "conn-b"));
      capture.packet(identityPacket(55, 41, "Aster Vale", "conn-b"));
      expect(await waitForSessionChange(directory, previousSessionId)).toBeDefined();
      capture.packet({ ...damagePacket(60, 900, 41), connectionId: "conn-b" });
      await coordinator.stop();

      const pointer = await readCurrentLogStream("combat", directory);
      const combat = records(await readFile(pointer!.path, "utf8")) as Array<{
        type: string;
        data?: { actorId?: number; displayName?: string; tick?: number };
      }>;
      const replayedIdentity = combat.findIndex((record) => record.type === "combat.actorIdentity"
        && record.data?.actorId === 41
        && record.data.displayName === "Aster Vale"
        && record.data.tick === 55);
      const damage = combat.findIndex((record) => record.type === "combat.event"
        && record.data?.actorId === 41);

      expect(replayedIdentity).toBeGreaterThan(-1);
      expect(damage).toBeGreaterThan(replayedIdentity);
      expect(combat.some((record) => record.type === "combat.actorIdentity" && record.data?.actorId === 40)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("records the incoming zone, not the previous zone, in an automatic map-change session", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-map-change-zone-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        resetOnMapChange: () => true,
      });
      await coordinator.start();

      capture.packet(authenticatedPacket(1_000, "conn-a"));
      capture.packet(mapPacket(1_010, 29, "conn-a"));
      const previousSessionId = (await readCurrentLogStream("combat", directory))?.sessionId;

      capture.packet(authenticatedPacket(50, "conn-b"));
      capture.packet(mapPacket(55, 48, "conn-b"));
      expect(await waitForSessionChange(directory, previousSessionId)).toBeDefined();
      await coordinator.stop();

      const pointer = await readCurrentLogStream("combat", directory);
      const zones = records(await readFile(pointer!.path, "utf8"))
        .filter((record) => record.type === "combat.event")
        .map((record) => (record as { data?: { sourceId?: string } }).data?.sourceId)
        .filter((sourceId): sourceId is string => sourceId?.startsWith("__spiritvaleZone:") ?? false);
      expect(zones).toEqual(["__spiritvaleZone:48"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rotates once for a same-connection waypoint map change and deduplicates its reconnect", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-waypoint-map-change-"));
    const capture = new FakeCapture();
    let goldResets = 0;
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        resetOnMapChange: () => true,
        onGoldMapChange: () => { goldResets += 1; },
      });
      await coordinator.start();
      capture.packet(authenticatedPacket(1_000, "conn-a"));
      capture.packet(mapPacket(1_010, 17, "conn-a"));
      const previousSessionId = (await readCurrentLogStream("combat", directory))?.sessionId;

      capture.packet(waypointPacket(1_020, 45, "conn-a"));
      const nextSessionId = await waitForSessionChange(directory, previousSessionId);
      expect(nextSessionId).toBeDefined();
      capture.packet(authenticatedPacket(50, "conn-b"));
      capture.packet(mapPacket(55, 45, "conn-b"));
      await settleRotation();
      expect((await readCurrentLogStream("combat", directory))?.sessionId).toBe(nextSessionId);
      await coordinator.stop();

      expect(await readdir(path.join(directory, "combat"))).toHaveLength(2);
      expect(goldResets).toBe(1);
      const pointer = await readCurrentLogStream("combat", directory);
      expect(loggedLocations(await readFile(pointer!.path, "utf8"))).toEqual(["__spiritvaleZone:45"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("clears actor lifetimes on same-connection character logout and rebuilds from fresh identities", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-character-boundary-"));
    const capture = new FakeCapture();
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        resetOnMapChange: () => true,
      });
      await coordinator.start();
      capture.packet(authenticatedPacket(1_000, "conn-a"));
      capture.packet(identityPacket(1_010, 40, "Former Ranger", "conn-a"));
      const previousSessionId = (await readCurrentLogStream("combat", directory))?.sessionId;

      capture.packet(quitCharacterPacket(1_020, "conn-a"));
      expect(await waitForSessionChange(directory, previousSessionId)).toBeDefined();
      capture.packet(loadCharacterPacket(1_030, "conn-a"));
      capture.packet(identityPacket(1_040, 41, "Current Ranger", "conn-a"));
      await coordinator.stop();

      const pointer = await readCurrentLogStream("combat", directory);
      const identities = records(await readFile(pointer!.path, "utf8")) as Array<{
        type: string;
        data?: { actorId?: number; displayName?: string };
      }>;
      expect(identities).toContainEqual(expect.objectContaining({
        type: "combat.actorIdentity",
        data: expect.objectContaining({ actorId: 41, displayName: "Current Ranger" }),
      }));
      expect(identities.some((record) => record.type === "combat.actorIdentity"
        && record.data?.actorId === 40)).toBe(false);
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

      resetOnMapChange = true;
      capture.packet(authenticatedPacket(25, "conn-c"));
      expect(await waitForSessionChange(directory, firstSessionId)).toBeDefined();

      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("fires onGoldMapChange on every map change after login, independent of resetOnMapChange", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-gold-map-change-"));
    const capture = new FakeCapture();
    let goldResets = 0;
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        resetOnMapChange: () => false,
        onGoldMapChange: () => { goldResets += 1; },
      });
      await coordinator.start();

      capture.packet(authenticatedPacket(1_000, "conn-a"));
      await settleRotation();
      expect(goldResets).toBe(0);

      capture.packet(authenticatedPacket(1_000, "conn-a"));
      await settleRotation();
      expect(goldResets).toBe(0);

      capture.packet(authenticatedPacket(50, "conn-b"));
      await settleRotation();
      expect(goldResets).toBe(1);

      capture.packet(authenticatedPacket(80, "conn-b"));
      await settleRotation();
      expect(goldResets).toBe(1);

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

      const rewardsPointerPath = path.join(directory, "current", "rewards.json");
      await rm(rewardsPointerPath, { force: true });
      await mkdir(rewardsPointerPath);

      await expect(coordinator.resetSession()).rejects.toThrow();

      const combatAfter = await readCurrentLogStream("combat", directory);
      expect(combatAfter?.sessionId).toBe(firstSessionId);

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

        const outgoing = await readCurrentLogStream("other", directory);

        const sentTicks = await sendAcross(coordinator.resetSession(), (tick) => {
          capture.packet(statusPacket(tick, 10, "conn-a"));
        });
        await coordinator.stop();

        const admissions = admissionRecords(await readOtherLogs(directory, outgoing?.path));
        const buffered = admissions.filter((record) => record.decision === "buffered");
        expect(buffered.length).toBeGreaterThan(0);
        expect(buffered.every((record) => record.reason === "capture-session-handoff")).toBe(true);
        expect(sentTicks).toContain(buffered[0]!.tick as number);

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
      let coordinator: CaptureCoordinator | undefined;
      try {
        coordinator = new CaptureCoordinator({
          logDirectory: directory,
          captureFactory: () => capture as unknown as PacketCapture,
          onError: (report) => errorReports.push(report),
        });
        await coordinator.start();
        capture.packet(authenticatedPacket(1_000, "conn-a"));

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
        await coordinator?.stop();
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

  test("forgets the channel and instance across a re-authentication", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-channel-reset-"));
    const capture = new FakeCapture();
    const sightings: Array<{
      mobId: string;
      bossName: string;
      killedBy?: string;
      channel?: number;
      instanceId?: string;
      diedAtMs: number;
    }> = [];
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        onBossGravestone: (gravestone) => sightings.push(gravestone),
      });
      await coordinator.start();

      capture.packet(authenticatedPacket(1, "test-connection"));
      capture.packet(channelListPacket(2, 0, "na3-12"));
      expect(coordinator.currentServerInstance()).toBe("na3-12");
      capture.packet(authenticatedPacket(3, "second-connection"));
      expect(coordinator.currentServerInstance()).toBeUndefined();
      const diedAtMs = Math.floor((Date.now() - 10 * 60_000) / 1_000) * 1_000;
      capture.packet(gravestonePacket(4, 700, diedAtMs, "Testerson", "Naga", "Snake Naga", "second-connection"));

      expect(sightings).toEqual([
        { mobId: "Snake Naga", bossName: "Naga", killedBy: "Testerson", diedAtMs },
      ]);
      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("dates a boss kill nobody witnessed from its gravestone", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-gravestone-"));
    const capture = new FakeCapture();
    const kills: Array<{
      mobId: string;
      bossName: string;
      killedBy?: string;
      channel?: number;
      instanceId?: string;
      diedAtMs: number;
    }> = [];
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        onBossGravestone: (gravestone) => kills.push(gravestone),
      });
      await coordinator.start();

      capture.packet(authenticatedPacket(1, "test-connection"));
      capture.packet(channelListPacket(2, 1, "na3-12"));
      const diedAtMs = Math.floor((Date.now() - 40 * 60_000) / 1_000) * 1_000;
      capture.packet(gravestonePacket(3, 700, diedAtMs, "Testerson", "Lady Fey", "Sunflora Pixie"));
      capture.packet(gravestonePacket(4, 700, diedAtMs, "Testerson", "Lady Fey", "Sunflora Pixie"));

      expect(kills).toEqual([{
        mobId: "Sunflora Pixie",
        bossName: "Lady Fey",
        killedBy: "Testerson",
        channel: 2,
        instanceId: "na3-12",
        diedAtMs,
      }]);
      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("times a kill from the sync that follows the marker's bare spawn", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-gravestone-sync-"));
    const capture = new FakeCapture();
    const kills: Array<{
      mobId: string;
      bossName: string;
      killedBy?: string;
      channel?: number;
      instanceId?: string;
      diedAtMs: number;
    }> = [];
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        onBossGravestone: (gravestone) => kills.push(gravestone),
      });
      await coordinator.start();

      capture.packet(authenticatedPacket(1, "test-connection"));
      capture.packet(channelListPacket(2, 1, "na3-15"));
      const diedAtMs = Math.floor((Date.now() - 5_000) / 1_000) * 1_000;
      capture.packet({
        tick: 3,
        packetId: 5,
        packetName: "objectSpawn",
        objectId: 700,
        raw: Buffer.alloc(0),
        payload: Buffer.alloc(0),
      });
      expect(kills).toHaveLength(0);
      capture.packet(gravestoneSyncPacket(3, 700, diedAtMs, "Vapulah", "Vespa", "Sting"));

      expect(kills).toEqual([{
        mobId: "Sting",
        bossName: "Vespa",
        killedBy: "Vapulah",
        channel: 2,
        instanceId: "na3-15",
        diedAtMs,
      }]);
      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("re-reports a gravestone first seen before the channel list arrived", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-gravestone-late-"));
    const capture = new FakeCapture();
    const kills: Array<{
      mobId: string;
      bossName: string;
      killedBy?: string;
      channel?: number;
      instanceId?: string;
      diedAtMs: number;
    }> = [];
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        onBossGravestone: (gravestone) => kills.push(gravestone),
      });
      await coordinator.start();

      capture.packet(authenticatedPacket(1, "test-connection"));
      const diedAtMs = Math.floor((Date.now() - 40 * 60_000) / 1_000) * 1_000;
      capture.packet(gravestonePacket(2, 700, diedAtMs, "Testerson", "Lady Fey", "Sunflora Pixie"));
      expect(kills).toEqual([
        { mobId: "Sunflora Pixie", bossName: "Lady Fey", killedBy: "Testerson", diedAtMs },
      ]);

      capture.packet(channelListPacket(3, 1, "na3-12"));
      capture.packet(gravestonePacket(4, 700, diedAtMs, "Testerson", "Lady Fey", "Sunflora Pixie"));
      expect(kills).toHaveLength(2);
      expect(kills[1]).toMatchObject({ mobId: "Sunflora Pixie", channel: 2, instanceId: "na3-12", diedAtMs });

      capture.packet(gravestonePacket(5, 700, diedAtMs, "Testerson", "Lady Fey", "Sunflora Pixie"));
      expect(kills).toHaveLength(2);
      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("announces the server instance as the player moves between regions", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-instance-feed-"));
    const capture = new FakeCapture();
    const instances: Array<string | undefined> = [];
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        onServerInstance: (instanceId) => instances.push(instanceId),
      });
      await coordinator.start();

      capture.packet(authenticatedPacket(1, "test-connection"));
      capture.packet(channelListPacket(2, 0, "na3-12"));
      capture.packet(channelListPacket(3, 2, "na3-12"));
      capture.packet(authenticatedPacket(4, "eu-connection"));
      capture.packet(channelListPacket(5, 0, "eu2-6", "eu-connection"));

      expect(instances).toEqual(["na3-12", undefined, "eu2-6"]);
      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("follows the channel list across a region change", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-central-region-change-"));
    const capture = new FakeCapture();
    const kills: Array<{ mobId: string; bossName: string; killedBy?: string; channel?: number; instanceId?: string; diedAtMs: number }> = [];
    try {
      const coordinator = new CaptureCoordinator({
        logDirectory: directory,
        captureFactory: () => capture as unknown as PacketCapture,
        onBossGravestone: (gravestone) => kills.push(gravestone),
      });
      await coordinator.start();

      const naDiedAtMs = Math.floor((Date.now() - 30 * 60_000) / 1_000) * 1_000;
      const euDiedAtMs = Math.floor((Date.now() - 20 * 60_000) / 1_000) * 1_000;
      capture.packet(authenticatedPacket(1, "test-connection"));
      capture.packet(channelListPacket(2, 2, "na3-12"));
      capture.packet(gravestonePacket(3, 300, naDiedAtMs, "Testerson", "Wraith King", "Wraith"));
      capture.packet(authenticatedPacket(4, "eu-connection"));
      capture.packet(channelListPacket(5, 0, "eu2-6", "eu-connection"));
      capture.packet(gravestonePacket(6, 310, euDiedAtMs, "Someone", "Wraith King", "Wraith", "eu-connection"));

      expect(kills).toEqual([
        { mobId: "Wraith", bossName: "Wraith King", killedBy: "Testerson", channel: 3, instanceId: "na3-12", diedAtMs: naDiedAtMs },
        { mobId: "Wraith", bossName: "Wraith King", killedBy: "Someone", channel: 1, instanceId: "eu2-6", diedAtMs: euDiedAtMs },
      ]);
      await coordinator.stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

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

async function readOtherLogs(directory: string, ...earlier: Array<string | undefined>): Promise<Array<{ type: string; data: Record<string, unknown> }>> {
  const pointer = await readCurrentLogStream("other", directory);
  const paths = new Set([...earlier, pointer?.path].filter((value): value is string => value !== undefined));
  const all: Array<{ type: string; data: Record<string, unknown> }> = [];
  for (const logPath of paths) {
    all.push(...records(await readFile(logPath, "utf8")) as Array<{ type: string; data: Record<string, unknown> }>);
  }
  return all;
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

  udp(packet: CapturedLiteNetLibPacket["udpPacket"]): void {
    this.emit("udpPacket", packet);
  }

  fail(error: Error): void {
    this.emit("error", error);
  }

  target(state: "waiting" | "active", processIds: number[] = []): void {
    this.emit("targetStatus", { processName: "SpiritVale.exe", state, processIds });
  }
}

type TestPacket = Omit<CapturedFishNetPacket, "liteNetPacket" | "connectionId"> & { connectionId?: string };

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

function loggedLocations(content: string): string[] {
  return (records(content) as Array<{ type: string; data?: { sourceId?: string } }>)
    .filter((record) => record.type === "combat.event")
    .map((record) => record.data?.sourceId)
    .filter((sourceId): sourceId is string =>
      sourceId !== undefined
      && (sourceId.startsWith("__spiritvaleZone:") || sourceId.startsWith("__spiritvaleTowerFloor:")));
}

function records(content: string): Array<{ type: string }> {
  return content.trim().split(/\r?\n/).filter(Boolean)
    .map((line) => JSON.parse(line) as unknown)
    .filter((entry) => !isLogStreamHeader(entry)) as Array<{ type: string }>;
}

function experiencePacket(tick: number, experience: number, coins: bigint): TestPacket {
  const payload = Buffer.concat([packed(experience), packed(1), packed(0), packed(1), packed(coins)]);
  return { tick, packetId: 4, packetName: "targetRpc", rpcName: "ExpCoinsChanged_T", raw: payload, payload };
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


function channelListPacket(
  tick: number,
  currentIndex: number,
  instanceId = "na3-12",
  connectionId?: string,
): TestPacket {
  return {
    tick,
    packetId: 22,
    packetName: "targetRpc",
    objectId: 1,
    rpcName: "ChannelList_T",
    decodedFields: [
      { name: "playerCounts", codec: "packedInt32Array", value: [39, 16, 17, 37, 15, 17, 17, 17, 16, 18] },
      { name: "currentIndex", codec: "packedInt32", value: currentIndex },
      { name: "instanceId", codec: "stringUtf8Packed", value: instanceId },
    ],
    raw: Buffer.alloc(0),
    payload: Buffer.alloc(0),
    ...(connectionId === undefined ? {} : { connectionId }),
  };
}

function gravestonePacket(
  tick: number,
  objectId: number,
  diedAtMs: number,
  killedBy: string,
  bossName: string,
  mobId: string,
  connectionId?: string,
): TestPacket {
  const payload = Buffer.alloc(0);
  return {
    tick,
    packetId: 5,
    packetName: "objectSpawn",
    objectId,
    raw: payload,
    payload,
    spawnSyncEntries: [{
      componentIndex: 0,
      networkBehaviourType: "BossGraveStone",
      index: 0,
      name: "_killInfo",
      fields: [
        { name: "KillTime", codec: "float64", value: diedAtMs / 1_000 },
        { name: "KillerName", codec: "stringUtf8Packed", value: killedBy },
        { name: "BossName", codec: "stringUtf8Packed", value: bossName },
        { name: "BossId", codec: "stringUtf8Packed", value: mobId },
      ],
    }],
    ...(connectionId === undefined ? {} : { connectionId }),
  };
}

function gravestoneSyncPacket(
  tick: number,
  objectId: number,
  diedAtMs: number,
  killedBy: string,
  bossName: string,
  mobId: string,
  connectionId?: string,
): TestPacket {
  const spawn = gravestonePacket(tick, objectId, diedAtMs, killedBy, bossName, mobId, connectionId);
  const [entry] = spawn.spawnSyncEntries!;
  const { componentIndex, networkBehaviourType, ...syncEntry } = entry!;
  return {
    ...spawn,
    packetId: 7,
    packetName: "syncType",
    networkBehaviourIndex: componentIndex,
    networkBehaviourType,
    spawnSyncEntries: undefined,
    syncEntries: [syncEntry],
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

function waypointPacket(tick: number, mapId: number, connectionId: string): TestPacket {
  return {
    tick,
    packetId: 900,
    packetName: "serverRpc",
    rpcName: "WarpWaypoint_S",
    networkBehaviourType: "PlayerSave",
    decodedFields: [{ name: "mapId", codec: "packedInt32", value: mapId }],
    raw: Buffer.alloc(0),
    payload: Buffer.alloc(0),
    connectionId,
  };
}

function quitCharacterPacket(tick: number, connectionId: string): TestPacket {
  return {
    tick,
    packetId: 900,
    packetName: "serverRpc",
    rpcName: "QuitCharacter_Rpc",
    networkBehaviourType: "PlayerSave",
    raw: Buffer.alloc(0),
    payload: Buffer.alloc(0),
    connectionId,
  };
}

function loadCharacterPacket(tick: number, connectionId: string): TestPacket {
  return {
    tick,
    packetId: 900,
    packetName: "targetRpc",
    rpcName: "LoadCharacter_T",
    networkBehaviourType: "PlayerSave",
    raw: Buffer.alloc(0),
    payload: Buffer.alloc(0),
    connectionId,
  };
}

function towerFloorPacket(tick: number, floor: number, connectionId: string): TestPacket {
  return {
    tick,
    packetId: 901,
    packetName: "targetRpc",
    rpcName: "DrawTitle",
    networkBehaviourType: "PlayerController",
    decodedFields: [
      { name: "title", codec: "stringUtf8Packed", value: `The Echoing Spire\nFloor ${floor}` },
    ],
    raw: Buffer.alloc(0),
    payload: Buffer.alloc(0),
    connectionId,
  };
}

function towerExitPacket(tick: number, connectionId: string): TestPacket {
  return {
    tick,
    packetId: 903,
    packetName: "serverRpc",
    rpcName: "ClientInstancedMapReady",
    networkBehaviourType: "PlayerController",
    decodedFields: [
      { name: "localMapInstanceId", codec: "packedInt32", value: 29 },
      { name: "instancedMapId", codec: "stringUtf8Packed", value: "world-29" },
      { name: "bindingSlot", codec: "stringUtf8Packed", value: "world" },
    ],
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
