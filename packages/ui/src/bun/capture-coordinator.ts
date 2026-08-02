import { FishNetActorDirectory, FishNetCombatTracker } from "@kar-mi/spirit-vale-tools-combat";
import type { FishNetCombatEvent, FishNetKnownIdentity } from "@kar-mi/spirit-vale-tools-combat";
import { FishNetCharacterTracker, resolveCharacterHealingTraits } from "@kar-mi/spirit-vale-tools-character";
import type { CharacterSnapshot, CharacterViewState } from "@kar-mi/spirit-vale-tools-character";
import { PacketCapture } from "@kar-mi/spirit-vale-tools-capture/capture";
import type { CapturedFishNetPacket, CaptureTargetStatus } from "@kar-mi/spirit-vale-tools-capture";
import {
  activateLogSession,
  createLogSession,
  readCurrentLogStream,
  writeCurrentLogStreamPointer,
} from "@kar-mi/spirit-vale-tools-logging";
import type {
  CurrentLogStream,
  JsonData,
  JsonLinesLogger,
  JsonObject,
  LogSession,
  LogStream,
  LogWriteFailure,
} from "@kar-mi/spirit-vale-tools-logging";
import { FishNetMarketTracker, marketEventLogData } from "@kar-mi/spirit-vale-tools-market";
import { FishNetMobDirectory, FishNetMobRewardTracker, mobDefinitionsById } from "@kar-mi/spirit-vale-tools-rewards";

import type { CaptureStatus, LauncherState } from "../launcher-types.ts";
import { RewardEventAttributor } from "./reward-event-attributor.ts";

const SPAWN_PAYLOAD_LOG_LIMIT = 2_048;
const HANDOFF_PACKET_LIMIT = 4_096;
const HANDOFF_BYTE_LIMIT = 16 * 1024 * 1024;
const WRITE_MONITOR_INTERVAL_MS = 5_000;
const GAME_NOT_RUNNING_DETAIL = "Capture Active - Game not running";
const WAITING_FOR_DATA_DETAIL = "Capture Active - Waiting on data (change channel/map if recently launched).";
const CAPTURE_ACTIVE_DETAIL = "Capture Active";
type CaptureCoordinatorState = Pick<LauncherState, "captureStatus" | "statusDetail">;

export interface CaptureErrorReport {
  title: string;
  reason: string;
  details?: Readonly<Record<string, string | number | boolean | undefined>>;
}

export interface CaptureCoordinatorOptions {
  logDirectory: string;
  deviceName?: string;
  captureFactory?: () => PacketCapture;
  onStatus?: (state: CaptureCoordinatorState) => void;
  /** Receives human-readable failures for the root-level fallback error log. */
  onError?: (report: CaptureErrorReport) => void;
  /**
   * Adds an internal "other" stream containing capture diagnostics and unclassified
   * FishNet packets. Defaults to the SPIRIT_VALE_DIAGNOSTIC_LOGS environment variable.
   */
  diagnosticLogging?: boolean;
  /** Party-member identities learned in prior sessions, used to seed the actor directory. */
  knownIdentities?: readonly FishNetKnownIdentity[];
  /** Invoked whenever a party member's identity is newly learned or changed, for persistence. */
  onIdentityLearned?: (identity: FishNetKnownIdentity) => void;
}

export class CaptureCoordinator {
  private readonly capture: PacketCapture;
  private readonly diagnosticLogging: boolean;
  private readonly actors: FishNetActorDirectory;
  private readonly combat = new FishNetCombatTracker({
    actorIdentityResolver: (actorId) => this.actors.getAttribution(actorId),
    healingTraitsResolver: (actorId: number) => {
      return actorId === this.localCharacterObjectId ? this.localHealingTraits() : undefined;
    },
    // Names each hit's target from the monster's spawn packet. The combat log carries no spawn
    // packets, so a name not stamped onto the event here cannot be recovered when the log is
    // replayed — which is why enemies that died without acting indexed as "Enemy <id>".
    monsterCatalog: mobDefinitionsById(),
  });
  private readonly rewards = new FishNetMobRewardTracker();
  private readonly rewardAttributor = new RewardEventAttributor();
  private readonly locallyDamagedRewardTargets = new Set<number>();
  private readonly mobs = new FishNetMobDirectory();
  private readonly market = new FishNetMarketTracker();
  private readonly character = new FishNetCharacterTracker();
  private session?: LogSession;
  private combatLog?: JsonLinesLogger;
  private rewardsLog?: JsonLinesLogger;
  private marketLog?: JsonLinesLogger;
  private otherLog?: JsonLinesLogger;
  private status: CaptureStatus = "stopped";
  private statusDetail = "Capture stopped";
  private stopping = false;
  private reconfiguring = false;
  private lifecycleStopped = false;
  private targetState: CaptureTargetStatus["state"] = "waiting";
  private receivedDataForCurrentGame = false;
  private activeConnectionId?: string;
  private lastAuthenticated?: { connectionId: string; tick: number };
  private localCharacterObjectId?: number;
  private resettingSession?: Promise<void>;
  private handoff = false;
  private packetBuffer: CapturedFishNetPacket[] = [];
  private packetBufferBytes = 0;
  private handoffFailure?: Error;
  private writeMonitor?: ReturnType<typeof setInterval>;
  private readonly loggedMobIdentities = new Map<number, string>();
  /** Serializes stop() and resetSession() so their bodies never interleave. */
  private lifecycleChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: CaptureCoordinatorOptions) {
    this.actors = new FishNetActorDirectory({
      ...(options.knownIdentities === undefined ? {} : { knownIdentities: options.knownIdentities }),
      ...(options.onIdentityLearned === undefined ? {} : { onIdentityLearned: options.onIdentityLearned }),
    });
    this.diagnosticLogging = options.diagnosticLogging ?? envFlag(Bun.env["SPIRIT_VALE_DIAGNOSTIC_LOGS"]);
    this.capture = options.captureFactory?.() ?? new PacketCapture();
    this.capture.on("started", () => this.captureStarted());
    this.capture.on("targetStatus", (target) => this.targetStatus(target));
    this.capture.on("warning", (message) => this.captureWarning(message));
    this.capture.on("error", (error) => this.captureError(error));
    this.capture.on("fishNetPacket", (packet) => this.routePacket(packet));
    this.capture.on("stopped", () => this.captureStopped());
  }

  state(): CaptureCoordinatorState {
    return { captureStatus: this.status, statusDetail: this.statusDetail };
  }

  characterState(): CharacterViewState { return this.character.state(); }

  setCachedCharacter(snapshot: CharacterSnapshot | undefined): void {
    this.character.setCached(snapshot);
    this.syncLocalActorIdentity();
  }

  subscribeCharacter(listener: (state: CharacterViewState) => void): () => void {
    return this.character.subscribe(listener);
  }

  async start(): Promise<void> {
    if (this.status === "starting" || this.status === "capturing") return;
    this.setStatus("starting", "Starting centralized capture…");
    try {
      if (!this.session) {
        const streams: LogStream[] = ["combat", "rewards", "market"];
        if (this.diagnosticLogging) streams.push("other");
        this.session = await createLogSession({
          producer: "desktop-capture",
          streams,
          logDirectory: this.options.logDirectory,
          onWriteError: (failure) => this.logWriteFailure(failure),
        });
        this.combatLog = this.session.logger("combat");
        this.rewardsLog = this.session.logger("rewards");
        this.marketLog = this.session.logger("market");
        this.otherLog = this.diagnosticLogging ? this.session.logger("other") : undefined;
      }
      this.otherLog?.log("capture.lifecycle", { state: "starting" });
      await this.startCapture();
    } catch (error) {
      const message = errorMessage(error);
      this.logCaptureError(message, "Capture could not start");
      this.setStatus("unavailable", "Unable to capture data");
    }
  }

  async reconfigure(deviceName?: string): Promise<void> {
    const previous = this.options.deviceName;
    if (deviceName === previous && this.status === "capturing") return;
    this.reconfiguring = true;
    this.setStatus("starting", "Switching capture adapter…");
    try {
      await this.capture.stop();
      this.options.deviceName = deviceName;
      await this.startCapture();
    } catch (error) {
      const requestedError = errorMessage(error);
      this.reportError("Capture adapter could not be changed", requestedError, {
        "Requested adapter": deviceName ?? "Automatic selection",
      });
      this.options.deviceName = previous;
      try {
        await this.capture.stop();
        await this.startCapture();
        throw new Error(`Could not switch capture adapter: ${requestedError}`);
      } catch (rollbackError) {
        if (errorMessage(rollbackError).startsWith("Could not switch capture adapter:")) throw rollbackError;
        this.reportError("The previous capture adapter could not be restored", errorMessage(rollbackError), {
          "Previous adapter": previous ?? "Automatic selection",
        });
        this.setStatus("unavailable", "Unable to capture data");
        throw new Error(`Could not switch capture adapter and restore the previous adapter: ${requestedError}`);
      }
    } finally {
      this.reconfiguring = false;
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    const run = this.lifecycleChain.catch(() => {}).then(() => this.performStop());
    this.lifecycleChain = run.catch(() => {});
    try {
      await run;
    } finally {
      this.stopping = false;
    }
  }

  private async performStop(): Promise<void> {
    this.clearWriteMonitor();
    try {
      await this.capture.stop();
    } catch (error) {
      this.logCaptureError(errorMessage(error), "Capture could not stop cleanly");
    }
    this.writeStoppedLifecycle();
    this.actors.reset();
    this.combat.reset();
    this.rewards.reset();
    this.rewardAttributor.reset();
    this.locallyDamagedRewardTargets.clear();
    this.mobs.reset();
    this.loggedMobIdentities.clear();
    this.clearPacketBuffer();
    this.market.reset();
    this.targetState = "waiting";
    this.receivedDataForCurrentGame = false;
    this.activeConnectionId = undefined;
    this.lastAuthenticated = undefined;
    const session = this.session;
    this.session = undefined;
    this.combatLog = undefined;
    this.rewardsLog = undefined;
    this.marketLog = undefined;
    this.otherLog = undefined;
    try {
      await session?.close();
    } catch (error) {
      console.error("[spiritvale-logging]", errorMessage(error));
    }
    this.setStatus("stopped", "Capture stopped");
  }

  /**
   * Rotates the shared capture session: combat, rewards, and market all start writing to a fresh
   * log session together, while actor/mob identities, reward baselines, and connection state carry
   * over so attribution keeps working immediately after the boundary. Concurrent calls coalesce
   * into the single in-flight rotation; a failed rotation leaves the previous session untouched.
   */
  async resetSession(): Promise<void> {
    if (this.resettingSession) return this.resettingSession;
    if (this.stopping) throw new Error("cannot reset the capture session while it is stopping");
    const run = this.lifecycleChain.catch(() => {}).then(() => this.performResetSession()).catch((error) => {
      this.reportError("Capture session could not be reset", errorMessage(error));
      throw error;
    });
    this.lifecycleChain = run.catch(() => {});
    const tracked = run.finally(() => {
      this.resettingSession = undefined;
    });
    this.resettingSession = tracked;
    return tracked;
  }

  private async performResetSession(): Promise<void> {
    const streams: LogStream[] = ["combat", "rewards", "market"];
    if (this.diagnosticLogging) streams.push("other");

    const nextSession = await createLogSession({
      producer: "desktop-capture",
      streams,
      logDirectory: this.options.logDirectory,
      activate: false,
      onWriteError: (failure) => this.logWriteFailure(failure),
    });

    this.handoff = true;
    this.handoffFailure = undefined;
    try {
      // Switch every stream's pointer onto the replacement session first, while the previous
      // session is still fully intact, so a failure here can be rolled back cleanly without
      // having touched anything the old session depends on.
      const previousPointers = new Map<LogStream, CurrentLogStream | undefined>();
      for (const stream of streams) {
        previousPointers.set(stream, await readCurrentLogStream(stream, this.options.logDirectory));
      }
      try {
        await activateLogSession(nextSession, streams, this.options.logDirectory);
      } catch (error) {
        await Promise.allSettled(streams.map((stream) => {
          const previous = previousPointers.get(stream);
          return previous ? writeCurrentLogStreamPointer(previous, this.options.logDirectory) : Promise.resolve();
        }));
        try {
          await nextSession.close();
        } catch {
          // The replacement session was never used; a close failure here is not actionable.
        }
        throw error;
      }

      // Pointers are now fully switched; finalize the old session and swap the coordinator's own
      // references. None of this can meaningfully fail (JsonLinesLogger.log is fire-and-forget).
      const previousSession = this.session;
      const rewardEvents = this.rewardAttributor.consume(
        this.rewards.flushSessionBoundary(),
        Number.POSITIVE_INFINITY,
      );
      this.rewardAttributor.reset();
      this.locallyDamagedRewardTargets.clear();
      for (const event of rewardEvents) {
        this.rewardsLog?.log(event.kind === "kill" ? "rewards.kill" : "rewards.unmatched", jsonObject(event));
      }
      this.combatLog?.log("combat.lifecycle", { state: "stopped" });
      this.rewardsLog?.log("rewards.lifecycle", { state: "stopped" });
      this.marketLog?.log("market.lifecycle", { state: "stopped" });
      this.otherLog?.log("capture.lifecycle", { state: "stopped" });

      // Combat activations and market aggregation do not carry meaning across a session boundary;
      // actor/mob identities and the reward baseline are preserved above.
      this.combat.reset();
      this.market.reset();

      this.session = nextSession;
      this.combatLog = nextSession.logger("combat");
      this.rewardsLog = nextSession.logger("rewards");
      this.marketLog = nextSession.logger("market");
      this.otherLog = this.diagnosticLogging ? nextSession.logger("other") : undefined;

      for (const identity of this.actors.snapshot()) {
        this.combatLog.log("combat.actorIdentity", jsonObject({ kind: "actorIdentity", operation: "upsert", tick: 0, ...identity }));
      }

      this.combatLog.log("combat.lifecycle", { state: "started" });
      this.rewardsLog.log("rewards.lifecycle", { state: "started" });
      this.marketLog.log("market.lifecycle", { state: "started" });
      this.otherLog?.log("capture.lifecycle", { state: "started" });

      // A completed rotation is an observable durability boundary: callers may immediately
      // follow the newly activated pointers and expect the seeded records to be readable.
      await nextSession.flush();

      try {
        await previousSession?.close();
      } catch (error) {
        console.error("[spiritvale-logging]", errorMessage(error));
      }
    } finally {
      this.handoff = false;
      const handoffFailure = this.handoffFailure;
      this.handoffFailure = undefined;
      if (handoffFailure) {
        this.clearPacketBuffer();
        throw handoffFailure;
      }
      this.drainBufferedPackets();
    }
  }

  private drainBufferedPackets(): void {
    if (this.packetBuffer.length === 0) return;
    const buffered = this.packetBuffer;
    this.packetBuffer = [];
    this.packetBufferBytes = 0;
    for (const packet of buffered) this.routePacket(packet);
  }

  private clearPacketBuffer(): void {
    this.packetBuffer = [];
    this.packetBufferBytes = 0;
  }

  private bufferHandoffPacket(packet: CapturedFishNetPacket): void {
    const bytes = packet.liteNetPacket.udpPacket.payload.byteLength;
    if (this.packetBuffer.length >= HANDOFF_PACKET_LIMIT || this.packetBufferBytes + bytes > HANDOFF_BYTE_LIMIT) {
      if (!this.handoffFailure) {
        this.handoffFailure = new Error("capture session handoff exceeded its bounded packet buffer");
        this.logCaptureError(this.handoffFailure.message, "Capture session reset could not keep up with incoming data");
        this.setStatus("unavailable", "Capture stopped: session reset could not keep up with incoming data");
        void this.capture.stop().catch((error) => this.logCaptureError(errorMessage(error)));
      }
      return;
    }
    this.packetBuffer.push(packet);
    this.packetBufferBytes += bytes;
  }

  private captureStarted(): void {
    this.lifecycleStopped = false;
    this.combatLog?.log("combat.lifecycle", { state: "started" });
    this.rewardsLog?.log("rewards.lifecycle", { state: "started" });
    this.marketLog?.log("market.lifecycle", { state: "started" });
    this.otherLog?.log("capture.lifecycle", { state: "started" });
    this.setStatus("capturing", this.captureDetail());
  }

  private targetStatus(target: CaptureTargetStatus): void {
    this.otherLog?.log("capture.targetStatus", {
      processName: target.processName,
      state: target.state,
      processIds: target.processIds,
    });
    this.targetState = target.state;
    if (target.state === "waiting") this.receivedDataForCurrentGame = false;
    this.refreshCaptureDetail();
  }

  private captureWarning(message: string): void {
    this.combatLog?.log("combat.warning", { message });
    this.rewardsLog?.log("rewards.warning", { message });
    this.marketLog?.log("market.warning", { message });
    this.otherLog?.log("capture.warning", { message });
  }

  private captureError(error: Error): void {
    this.logCaptureError(error.message, "Packet capture stopped unexpectedly");
    if (!this.stopping) this.setStatus("unavailable", "Unable to capture data");
  }

  private captureStopped(): void {
    if (this.reconfiguring) return;
    this.writeStoppedLifecycle();
    if (!this.stopping && this.status !== "unavailable") this.setStatus("stopped", "Capture stopped");
  }

  private startCapture(): Promise<void> {
    return this.capture.start({
      protocols: ["udp"],
      targetProcessName: "SpiritVale.exe",
      decodeFishNet: true,
      deviceName: this.options.deviceName,
    });
  }

  private routePacket(packet: CapturedFishNetPacket): void {
    if (this.handoff) {
      this.bufferHandoffPacket(packet);
      return;
    }
    if (!this.receivedDataForCurrentGame) {
      this.receivedDataForCurrentGame = true;
      this.refreshCaptureDetail();
    }
    let characterHandled = false;
    try {
      // PlayerSave callbacks describe the local character and may arrive while game-server
      // connections overlap during login or a map change. Decode them before selecting the
      // active combat connection so a valid local snapshot is never discarded as stale.
      characterHandled = this.character.consume(packet);
      if (packet.packetName === "serverRpc" && packet.objectId !== undefined) {
        this.localCharacterObjectId = packet.objectId;
      }
      if (characterHandled) this.syncLocalActorIdentity();
    } catch (error) {
      characterHandled = true;
      this.otherLog?.log("capture.warning", {
        domain: "character",
        message: `skipped character payload: ${errorMessage(error)}`,
        rpcName: packet.rpcName ?? null,
        objectId: packet.objectId ?? null,
        payloadHex: packet.payload.subarray(0, SPAWN_PAYLOAD_LOG_LIMIT).toString("hex"),
        payloadBytes: packet.payload.length,
      });
    }
    if (!this.admitPacket(packet)) return;
    if (packet.splitDropReason !== undefined) {
      this.combatLog?.log("combat.warning", {
        message: `split reassembly dropped (${packet.splitDropReason}) at tick ${packet.tick}`,
      });
    }
    let handled = characterHandled;
    let combatEvents: FishNetCombatEvent[] = [];
    try {
      this.mobs.consume(packet);
      if (packet.packetName === "authenticated" || packet.packetName === "disconnect") {
        this.loggedMobIdentities.clear();
      }
      const identities = this.actors.consume(packet);
      const events = this.combat.consume(packet);
      combatEvents = events;
      for (const event of events) {
        if ((event.kind === "damage" || event.kind === "death") && event.team === 0) {
          identities.push(...this.actors.observePlayerActor(event.actorId, event.tick));
        }
        if (event.kind === "death" && event.team !== 0) {
          // The target is the player who died. Resolve and persist its identity before the
          // death event so replay analysis can identify every victim, not only attackers.
          identities.push(...this.actors.observePlayerActor(event.targetId, event.tick));
        }
      }
      handled ||= identities.length > 0 || events.length > 0;
      for (const event of identities) this.combatLog?.log("combat.actorIdentity", jsonObject(event));
      for (const event of events) if (event.actorId !== undefined) this.logMobIdentity(event.actorId, event.tick);
      for (const event of events) this.combatLog?.log("combat.event", jsonObject(event));
      // Spawn diagnostics contain raw protocol payloads and are intentionally not written to combat logs.
    } catch (error) {
      handled = true;
      this.logDomainWarning("combat", error);
    }

    try {
      const tracked = this.shouldTrackRewardPacket(combatEvents) ? this.rewards.consume(packet) : [];
      const events = this.rewardAttributor.consume(tracked, packet.tick);
      if (packet.packetName === "authenticated" || packet.packetName === "disconnect") {
        events.push(...this.rewardAttributor.flush());
        this.locallyDamagedRewardTargets.clear();
      }
      handled ||= events.length > 0;
      for (const event of events) {
        this.rewardsLog?.log(event.kind === "kill" ? "rewards.kill" : "rewards.unmatched", jsonObject(event));
      }
    } catch (error) {
      handled = true;
      this.logDomainWarning("rewards", error);
    }

    try {
      const events = this.market.consume(packet);
      handled ||= events.length > 0;
      for (const event of events) this.marketLog?.log("market.event", marketEventLogData(event));
    } catch (error) {
      handled = true;
      this.logDomainWarning("market", error);
    }

    if (!handled && this.diagnosticLogging) this.otherLog?.log("fishnet.packet", unclassifiedPacket(packet));
  }

  private localHealingTraits(): { hasSiphonHealth: boolean; hasHealthLeech: boolean } | undefined {
    const snapshot = this.character.current();
    return snapshot ? resolveCharacterHealingTraits(snapshot) : undefined;
  }

  /** Only local-player combat may create reward candidates; team 0 includes every nearby player. */
  private shouldTrackRewardPacket(events: readonly FishNetCombatEvent[]): boolean {
    const combat = events.filter((event) => event.kind === "damage" || event.kind === "death");
    if (combat.length === 0) return true;
    let relevant = false;
    for (const event of combat) {
      if (event.team !== 0) continue;
      const localActor = this.isLocalRewardActor(event.actorId);
      if (event.kind === "damage") {
        if (localActor && event.value > 0) {
          this.locallyDamagedRewardTargets.add(event.targetId);
          relevant = true;
        }
        continue;
      }
      const locallyDamaged = this.locallyDamagedRewardTargets.delete(event.targetId);
      if (localActor || locallyDamaged) relevant = true;
    }
    return relevant;
  }

  private isLocalRewardActor(actorId: number): boolean {
    if (actorId === this.localCharacterObjectId) return true;
    const characterName = this.character.current()?.name;
    return characterName !== undefined && this.actors.getAttribution(actorId)?.displayName === characterName;
  }

  private logMobIdentity(actorId: number, tick: number): void {
    const mob = this.mobs.get(actorId);
    if (!mob) return;
    const fingerprint = `${mob.mobId}\u0000${mob.level}\u0000${mob.displayName}`;
    if (this.loggedMobIdentities.get(actorId) === fingerprint) return;
    this.loggedMobIdentities.set(actorId, fingerprint);
    // Combat-log sanitization permits only known record types. An activation is inert to the
    // DPS meter, so carry the catalog mapping in a reserved activation source that replays can
    // recognize without introducing a new unsanitized log record type.
    this.combatLog?.log("combat.event", jsonObject({
      kind: "activation",
      tick,
      actorId,
      sourceId: `__spiritvaleMobIdentity:${mob.mobId}`,
      sourceLabel: mob.displayName,
      level: mob.level,
    }));
  }

  /**
   * Routes only the active game-server connection. Map changes open a new connection whose
   * trailing authenticated/disconnect packets from the old one must not wipe fresh actor state.
   */
  private admitPacket(packet: CapturedFishNetPacket): boolean {
    const connectionId = packet.connectionId;
    this.activeConnectionId ??= connectionId;
    if (connectionId !== this.activeConnectionId) {
      if (packet.packetName !== "authenticated") return false;
      this.activeConnectionId = connectionId;
    }
    if (packet.packetName === "authenticated") {
      if (this.lastAuthenticated?.connectionId === connectionId && this.lastAuthenticated.tick === packet.tick) {
        return false;
      }
      this.lastAuthenticated = { connectionId, tick: packet.tick };
    }
    if (packet.packetName === "disconnect") this.activeConnectionId = undefined;
    return true;
  }

  private syncLocalActorIdentity(): void {
    const snapshot = this.character.current();
    if (!snapshot) return;
    const archetype = this.character.currentArchetypeId();
    this.actors.setLocalIdentity({
      displayName: snapshot.name,
      ...(archetype === undefined ? {} : { archetype }),
    });
  }

  private logDomainWarning(domain: "combat" | "rewards" | "market", error: unknown): void {
    const message = `skipped ${domain} payload: ${errorMessage(error)}`;
    if (domain === "combat") this.combatLog?.log("combat.warning", { message });
    else if (domain === "rewards") this.rewardsLog?.log("rewards.warning", { message });
    else this.marketLog?.log("market.warning", { message });
    this.otherLog?.log("capture.warning", { domain, message });
  }

  private logCaptureError(message: string, title = "Capture failed"): void {
    this.combatLog?.log("combat.error", { message });
    this.rewardsLog?.log("rewards.error", { message });
    this.marketLog?.log("market.error", { message });
    this.otherLog?.log("capture.error", { message });
    this.reportError(title, message);
  }

  private reportError(
    title: string,
    reason: string,
    details?: Readonly<Record<string, string | number | boolean | undefined>>,
  ): void {
    try {
      this.options.onError?.({ title, reason, ...(details === undefined ? {} : { details }) });
    } catch (error) {
      console.error("[spiritvale-error-log]", errorMessage(error));
    }
  }

  /**
   * A write failure alone does not end the session. The logger reports its first error once and
   * keeps attempting later batches, so a transient fault (an AV scanner holding the file, brief
   * disk contention) recovers on its own; tearing capture down there would turn a hiccup into a
   * lost session. The status warning is raised immediately, and a monitor then watches for the one
   * condition that is not recoverable: the bounded buffer filling up and records being dropped, at
   * which point the log has stopped being a faithful record and capture is stopped.
   */
  private logWriteFailure(failure: LogWriteFailure): void {
    console.error("[spiritvale-logging]", `${failure.stream}: ${failure.error.message}`);
    this.reportError("Capture logs could not be written", failure.error.message, {
      "Affected log": failure.stream,
    });
    if (this.stopping) return;
    if (this.status !== "unavailable") this.setStatus("unavailable", "Unable to write capture logs");
    this.watchForDroppedRecords();
  }

  private watchForDroppedRecords(): void {
    if (this.writeMonitor || this.stopping) return;
    this.writeMonitor = setInterval(() => {
      if (this.stopping) {
        this.clearWriteMonitor();
        return;
      }
      if (this.droppedRecords() === 0) return;
      this.clearWriteMonitor();
      this.setStatus("unavailable", "Capture stopped: capture logs could not be written");
      void this.capture.stop().catch((error) => console.error("[spiritvale-capture]", errorMessage(error)));
    }, WRITE_MONITOR_INTERVAL_MS);
    this.writeMonitor.unref?.();
  }

  private clearWriteMonitor(): void {
    if (!this.writeMonitor) return;
    clearInterval(this.writeMonitor);
    this.writeMonitor = undefined;
  }

  private droppedRecords(): number {
    return [this.combatLog, this.rewardsLog, this.marketLog, this.otherLog]
      .reduce((total, logger) => total + (logger?.stats().droppedRecords ?? 0), 0);
  }

  private writeStoppedLifecycle(): void {
    if (this.lifecycleStopped) return;
    this.lifecycleStopped = true;
    const events = this.rewardAttributor.consume(this.rewards.flush(), Number.POSITIVE_INFINITY);
    this.rewardAttributor.reset();
    this.locallyDamagedRewardTargets.clear();
    for (const event of events) {
      this.rewardsLog?.log(event.kind === "kill" ? "rewards.kill" : "rewards.unmatched", jsonObject(event));
    }
    this.combatLog?.log("combat.lifecycle", { state: "stopped" });
    this.rewardsLog?.log("rewards.lifecycle", { state: "stopped" });
    this.marketLog?.log("market.lifecycle", { state: "stopped" });
    this.otherLog?.log("capture.lifecycle", { state: "stopped" });
  }

  private setStatus(status: CaptureStatus, statusDetail: string): void {
    if (this.status === status && this.statusDetail === statusDetail) return;
    this.status = status;
    this.statusDetail = statusDetail;
    this.options.onStatus?.(this.state());
  }

  private refreshCaptureDetail(): void {
    if (this.status !== "capturing") return;
    this.setStatus("capturing", this.captureDetail());
  }

  private captureDetail(): string {
    if (this.targetState === "waiting") return GAME_NOT_RUNNING_DETAIL;
    return this.receivedDataForCurrentGame ? CAPTURE_ACTIVE_DETAIL : WAITING_FOR_DATA_DETAIL;
  }
}

function unclassifiedPacket(packet: CapturedFishNetPacket): JsonObject {
  return jsonObject({
    tick: packet.tick,
    packetId: packet.packetId,
    packetName: packet.packetName,
    objectId: packet.objectId,
    ownerConnectionId: packet.ownerConnectionId,
    rpcName: packet.rpcName,
    rpcResolution: packet.rpcResolution,
    networkBehaviourType: packet.networkBehaviourType,
    networkBehaviourIndex: packet.networkBehaviourIndex,
    decodedFields: packet.decodedFields,
    syncName: packet.syncName,
    broadcastName: packet.broadcastName,
    // TEMP DEBUG (heal-tracking investigation): raw bytes so a resolved-but-incomplete Recover_C
    // can be inspected byte-for-byte instead of guessing why `amount` failed to decode. Remove once
    // the rpcLink payload-length issue is understood.
    linkId: packet.linkId,
    linkResolved: packet.linkResolved,
    registeredObjectId: packet.registeredObjectId,
    registeredComponentIndex: packet.registeredComponentIndex,
    registeredRpcHash: packet.registeredRpcHash,
    rpcHash: packet.rpcHash,
    rpcPayloadLength: packet.rpcPayloadLength,
    payloadHex: packet.payload,
    undecodedPayloadHex: packet.undecodedPayload,
    rawHex: packet.raw,
  });
}

function jsonObject(value: object): JsonObject {
  return jsonValue(value) as JsonObject;
}

function jsonValue(value: unknown): JsonData {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => entry === undefined ? [] : [[key, jsonValue(entry)]]));
  }
  return String(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function envFlag(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}
