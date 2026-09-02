import {
  FishNetCombatTracker,
  FishNetPositionTracker,
  FishNetStatusTracker,
  normalizeName,
} from "@kar-mi/spirit-vale-tools-combat";
import type {
  FishNetActiveStatus,
  FishNetActorIdentity,
  FishNetCombatEvent,
  FishNetKnownIdentity,
  FishNetPosition,
} from "@kar-mi/spirit-vale-tools-combat";
import { FishNetInspectRoster, resolveCharacterHealingTraits } from "@kar-mi/spirit-vale-tools-character";
import type { CharacterSnapshot, CharacterViewState, InspectedCharacter } from "@kar-mi/spirit-vale-tools-character";
import { PacketCapture } from "@kar-mi/spirit-vale-tools-capture/capture";
import { decodeBossGravestone, FishNetEternalTowerTracker } from "@kar-mi/spirit-vale-tools-capture";
import type {
  CaptureConnectionEvent,
  CapturedFishNetPacket,
  CaptureTargetStatus,
} from "@kar-mi/spirit-vale-tools-capture";
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
import { FishNetLootDropTracker, FishNetMobDirectory, FishNetMobRewardTracker } from "@kar-mi/spirit-vale-tools-rewards";
import type { FishNetLootDrop, FishNetLootDropEvent } from "@kar-mi/spirit-vale-tools-rewards";
import { TOWER_FLOOR_EVENT_SOURCE_PREFIX, TOWER_FLOOR_UNKNOWN_SUFFIX, ZONE_EVENT_SOURCE_PREFIX } from "@svoverlay/combat/zone-log";
import { sameSpiritValeLocation, type SpiritValeLocation } from "@svoverlay/desktop-platform/location";
import { getCurrentExecutableNames } from "@svoverlay/desktop-platform/executable-names";

import { sameLocalizedText, type LocalizedText } from "@svoverlay/i18n/messages";
import { message } from "@svoverlay/i18n/backend";
import type { CaptureStatus, LauncherState } from "../launcher/types.ts";
import type { BossGravestoneObservation } from "./boss-timer-coordinator.ts";
import { CaptureDiagnostics } from "./capture-diagnostics.ts";
import { CaptureHealthMonitor } from "./capture-health-monitor.ts";
import { systemClock, type Clock, type ClockTimer } from "./clock.ts";
import { LocalCharacterRouter } from "./local-character-router.ts";
import { combatMonsterIdentityCatalog } from "./monster-identity-catalog.ts";
import { RewardEventAttributor } from "./reward-event-attributor.ts";
import { StickyActorDirectory } from "./sticky-actor-directory.ts";

const SPAWN_PAYLOAD_LOG_LIMIT = 2_048;
const HANDOFF_PACKET_LIMIT = 4_096;
const HANDOFF_BYTE_LIMIT = 16 * 1024 * 1024;
const CAPTURE_LOG_BUFFER_BYTES = 1024 * 1024 * 1024;
const WRITE_MONITOR_INTERVAL_MS = 5_000;
const CAPTURE_STALL_WARNING_MS = 15_000;
const UNRESOLVED_REPORT_INTERVAL_MS = 60_000;
const UNRESOLVED_REPORT_ENTRIES = 5;
const TOWER_LOCATION_SETTLE_MS = 500;
const MINIMAP_PUBLISH_MS = 60;
const TOWER_LOCATION_MAX_SETTLE_MS = 2_000;
const STATUS_RPC_NAMES = new Set([
  "ApplyEffect_T",
  "RemoveEffect_T",
  "ApplyEffectDisplays_O",
  "ApplySkillDisplay_O",
  "RemoveSkillDisplay_O",
]);
const LOCAL_TARGET_MAP_RPC = "TraverseActive";
const OBJECT_MAP_RPC_NAMES = new Set(["TraverseObservers", "SyncInstanceState"]);
const GAME_NOT_RUNNING_DETAIL = message("capture.status.gameNotRunning");
const WAITING_FOR_DATA_DETAIL = message("capture.status.waitingOnData");
const CAPTURE_ACTIVE_DETAIL = message("capture.status.active");
const gameProcessName = getCurrentExecutableNames().gameProcess;
type CaptureCoordinatorState = Pick<LauncherState, "captureStatus" | "statusDetail" | "captureWarning">;

interface SessionSeed {
  identities?: readonly FishNetActorIdentity[];
  location?: SpiritValeLocation;
  resetRewards?: boolean;
}

interface PacketAdmission {
  accepted: boolean;
  suppressBeforeAdmission: boolean;
}

export interface CaptureMinimapState {
  self: FishNetPosition | undefined;
  loot: FishNetLootDrop[];
}

export interface CaptureLootToastEvent {
  objectId: number;
  displayName?: string;
  rarity?: number;
  spriteId?: string;
  lootChance?: number;
}

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
  onError?: (report: CaptureErrorReport) => void;
  onWarning?: (report: CaptureErrorReport) => void;
  diagnosticLogging?: boolean;
  knownIdentities?: readonly FishNetKnownIdentity[];
  onIdentityLearned?: (identity: FishNetKnownIdentity) => void;
  resetOnMapChange?: () => boolean;
  onGoldMapChange?: () => void;
  minimapEnabled?: () => boolean;
  getMinimapRarityFilter?: () => number;
  getMinimapLootChanceFilter?: () => number;
  onBossGravestone?: (gravestone: BossGravestoneObservation) => void;
  onServerInstance?: (instanceId: string | undefined) => void;
  stallWarningMs?: number;
  onSessionEnded?: (sessionId: string) => Promise<void>;
  clock?: Clock;
}

export class CaptureCoordinator {
  private readonly capture: PacketCapture;
  private readonly diagnostics: CaptureDiagnostics;
  private readonly health: CaptureHealthMonitor;
  private readonly actors: StickyActorDirectory;
  private readonly combat = new FishNetCombatTracker({
    actorIdentityResolver: (actorId) => this.actors.getAttribution(actorId),
    healingTraitsResolver: (actorId: number) => {
      return actorId === this.character.physicalObjectId() ? this.localHealingTraits() : undefined;
    },
    monsterCatalog: combatMonsterIdentityCatalog(),
  });
  private readonly statusTracker = new FishNetStatusTracker();
  private readonly activeStatusListeners = new Set<(statuses: readonly FishNetActiveStatus[]) => void>();
  private activeStatusTimer?: ClockTimer;
  private lastPublishedStatusRevision = -1;
  private lastPublishedStatusActorId: number | undefined;
  private readonly loggedShortDisplayStatuses = new Set<string>();
  private readonly rewards = new FishNetMobRewardTracker();
  private readonly tower = new FishNetEternalTowerTracker();
  private readonly rewardAttributor = new RewardEventAttributor();
  private readonly locallyDamagedRewardTargets = new Set<number>();
  private readonly unresolvedCounts = new Map<string, number>();
  private unresolvedReportedAtMs = 0;
  private readonly mobs = new FishNetMobDirectory();
  private readonly positions: FishNetPositionTracker;
  private readonly loot = new FishNetLootDropTracker();
  private readonly minimapListeners = new Set<(state: CaptureMinimapState) => void>();
  private minimapTimer?: ClockTimer;
  private lastPublishedMinimapJson?: string;
  private readonly lootToastListeners = new Set<(event: CaptureLootToastEvent) => void>();
  private readonly toastedLootIds = new Set<number>();
  private readonly character = new LocalCharacterRouter({
    onHandled: () => this.syncLocalActorIdentity(),
    onError: (packet, error) => this.logCharacterWarning(packet, error),
  });
  private readonly inspected = new FishNetInspectRoster(Number.POSITIVE_INFINITY);
  private session?: LogSession;
  private combatLog?: JsonLinesLogger;
  private rewardsLog?: JsonLinesLogger;
  private otherLog?: JsonLinesLogger;
  private status: CaptureStatus = "stopped";
  private statusDetail: LocalizedText = message("capture.status.stopped");
  private stopping = false;
  private reconfiguring = false;
  private lifecycleStopped = false;
  private targetState: CaptureTargetStatus["state"] = "waiting";
  private missingGameReported = false;
  private receivedDataForCurrentGame = false;
  private activeConnectionId?: string;
  private lastClosedConnectionId?: string;
  private lastAuthenticated?: { connectionId: string; tick: number };
  private sawAuthenticated = false;
  private sawAdmittedTrafficBeforeAuthentication = false;
  private resettingSession?: Promise<void>;
  private handoff = false;
  private packetBuffer: CapturedFishNetPacket[] = [];
  private packetBufferBytes = 0;
  private handoffFailure?: Error;
  private writeMonitor?: ClockTimer;
  private summaryFinalization: Promise<void> = Promise.resolve();
  private readonly loggedMobIdentities = new Map<number, string>();
  private lastLoggedLocation: SpiritValeLocation | undefined;
  private lastObservedMapId: number | undefined;
  private pendingDirectWorldTransition = false;
  private pendingCharacterBoundary = false;
  private towerLocationTimer?: ClockTimer;
  private towerLocationDeadlineMs?: number;
  private pendingTowerLocationTick = 0;
  private currentChannel: number | undefined;
  private currentInstanceId: string | undefined;
  private readonly reportedGravestones = new Map<number, string>();
  private lifecycleChain: Promise<void> = Promise.resolve();
  private readonly clock: Clock;
  constructor(private readonly options: CaptureCoordinatorOptions) {
    this.clock = options.clock ?? systemClock;
    this.actors = new StickyActorDirectory({
      ...(options.knownIdentities === undefined ? {} : { knownIdentities: options.knownIdentities }),
      ...(options.onIdentityLearned === undefined ? {} : { onIdentityLearned: options.onIdentityLearned }),
    });
    this.positions = new FishNetPositionTracker({ directory: this.actors });
    this.capture = options.captureFactory?.() ?? new PacketCapture();
    this.diagnostics = new CaptureDiagnostics(
      options.diagnosticLogging ?? envFlag(Bun.env["SPIRIT_VALE_DIAGNOSTIC_LOGS"]),
    );
    this.health = new CaptureHealthMonitor({
      capture: this.capture,
      diagnosticLogging: this.diagnostics.enabled,
      stallWarningMs: options.stallWarningMs ?? CAPTURE_STALL_WARNING_MS,
      ...(options.deviceName === undefined ? {} : { deviceName: options.deviceName }),
      onLiteNetPacket: (packet) => this.diagnostics.consumeLiteNet(packet),
      onChange: () => this.publishCaptureHealthChange(),
      onWarning: ({ title, reason, details }) => this.reportWarning(title, reason, details),
      clock: this.clock,
    });
    this.capture.on("started", () => this.captureStarted());
    this.capture.on("targetStatus", (target) => this.targetStatus(target));
    this.capture.on("warning", (message) => this.captureWarning(message));
    this.capture.on("error", (error) => this.captureError(error));
    this.capture.on("connection", (event) => this.connectionChanged(event));
    this.capture.on("fishNetPacket", (packet) => this.routePacket(packet));
    this.capture.on("stopped", () => this.captureStopped());
  }

  /**
   * Follows the connection the capture reports the game is on.
   *
   * A channel change reconnects, and `authenticated` is the only packet that announced it here. One
   * lost packet meant every packet from the live connection was refused for the rest of its life:
   * the overlay froze on that channel and came back only after changing channel again. The
   * transport reports every connect and disconnect, so no single packet decides it any more.
   */
  private connectionChanged(event: CaptureConnectionEvent): void {
    const previous = this.activeConnectionId;
    if (event.state === "closed") {
      // A connection goes on sending for a moment after it is told to close, and those stragglers
      // must not take the free slot back from the connection replacing it.
      this.lastClosedConnectionId = event.connectionId;
      if (previous === event.connectionId) this.setActiveConnection(undefined);
    } else {
      this.lastClosedConnectionId = undefined;
      this.setActiveConnection(event.connectionId);
    }
    this.otherLog?.log("capture.connection", {
      state: event.state,
      connectionId: event.connectionId,
      previous: previous ?? null,
      active: this.activeConnectionId ?? null,
    });
  }

  /**
   * Moves the active connection
   *
   * Everything below is scoped to one connection: the channel and instance stamped onto a boss
   * timer, the map, and the trackers whose object ids only mean anything on the connection that
   * spawned them.
   */
  private setActiveConnection(connectionId: string | undefined): void {
    if (this.activeConnectionId === connectionId) return;
    this.activeConnectionId = connectionId;
    this.resetTrackers("connection");
  }

  /**
   * Clears the trackers whose contents stop meaning anything past a boundary.
   */
  private resetTrackers(scope: "connection" | "character" | "full"): void {
    const character = scope === "character" || scope === "full";

    this.lastObservedMapId = undefined;
    this.currentChannel = undefined;
    this.setServerInstance(undefined);
    this.loggedMobIdentities.clear();
    this.reportedGravestones.clear();
    this.loggedShortDisplayStatuses.clear();
    this.toastedLootIds.clear();
    this.positions.reset();
    this.loot.reset();
    this.tower.reset();
    this.mobs.reset();

    if (character) {
      this.actors.reset();
      this.combat.reset();
      this.statusTracker.reset();
      this.publishActiveStatuses(true);
    }

    if (this.minimapEnabled()) this.publishMinimap(true);
  }

  state(): CaptureCoordinatorState {
    const warning = this.health.warning();
    return {
      captureStatus: this.status,
      statusDetail: this.statusDetail,
      ...(warning === undefined ? {} : { captureWarning: warning }),
    };
  }

  characterState(): CharacterViewState { return this.character.state(); }

  currentServerInstance(): string | undefined { return this.currentInstanceId; }

  private consumeGravestone(packet: CapturedFishNetPacket): boolean {
    // A fresh marker spawns carrying none of its fields and sends them straight after in a SyncType;
    // only one already standing carries them in the spawn. Offering spawns alone missed every kill
    // the player was present for.
    if (packet.objectId === undefined) return false;
    if (packet.packetName !== "objectSpawn" && packet.packetName !== "syncType") return false;
    const gravestone = decodeBossGravestone(packet);
    if (!gravestone) return false;
    const fingerprint = [
      gravestone.mobId,
      gravestone.diedAtMs,
      this.currentChannel ?? "?",
      this.currentInstanceId ?? "?",
    ].join("\u0000");
    if (this.reportedGravestones.get(packet.objectId) === fingerprint) return true;
    this.reportedGravestones.set(packet.objectId, fingerprint);
    this.options.onBossGravestone?.({
      mobId: gravestone.mobId,
      bossName: gravestone.bossName,
      killedBy: gravestone.killedBy,
      ...(this.currentChannel === undefined ? {} : { channel: this.currentChannel }),
      ...(this.currentInstanceId === undefined ? {} : { instanceId: this.currentInstanceId }),
      diedAtMs: gravestone.diedAtMs,
    });
    return true;
  }

  setCachedCharacter(snapshot: CharacterSnapshot | undefined): void {
    this.character.setCached(snapshot);
    this.syncLocalActorIdentity();
  }

  subscribeCharacter(listener: (state: CharacterViewState) => void): () => void {
    return this.character.subscribe(listener);
  }

  subscribeActiveStatuses(listener: (statuses: readonly FishNetActiveStatus[]) => void): () => void {
    this.activeStatusListeners.add(listener);
    listener(this.activeStatuses());
    return () => this.activeStatusListeners.delete(listener);
  }

  subscribeMinimap(listener: (state: CaptureMinimapState) => void): () => void {
    this.minimapListeners.add(listener);
    listener(this.minimapState());
    return () => this.minimapListeners.delete(listener);
  }

  subscribeLootToast(listener: (event: CaptureLootToastEvent) => void): () => void {
    this.lootToastListeners.add(listener);
    return () => this.lootToastListeners.delete(listener);
  }

  inspectedCharacters(): InspectedCharacter[] { return this.inspected.list(); }

  subscribeInspectedCharacters(listener: (roster: InspectedCharacter[]) => void): () => void {
    return this.inspected.subscribe(listener);
  }

  async start(): Promise<void> {
    if (this.status === "starting" || this.status === "capturing") return;
    this.setStatus("starting", message("capture.status.starting"));
    try {
      if (!this.session) {
        const streams: LogStream[] = ["combat", "rewards"];
        if (this.diagnostics.enabled) streams.push("other");
        this.session = await createLogSession({
          producer: "desktop-capture",
          streams,
          logDirectory: this.options.logDirectory,
          maxBufferedBytes: CAPTURE_LOG_BUFFER_BYTES,
          onWriteError: (failure) => this.logWriteFailure(failure),
        });
        this.combatLog = this.session.logger("combat");
        this.rewardsLog = this.session.logger("rewards");
        this.otherLog = this.diagnostics.enabled ? this.session.logger("other") : undefined;
        this.diagnostics.setLogger(this.otherLog);
      }
      this.otherLog?.log("capture.lifecycle", { state: "starting" });
      await this.startCapture();
    } catch (error) {
      const failureMessage = errorMessage(error);
      this.logCaptureError(failureMessage, "Capture could not start");
      this.setStatus("unavailable", message("capture.status.restartRequired"));
    }
  }

  async reconfigure(deviceName?: string): Promise<void> {
    const previous = this.options.deviceName;
    if (deviceName === previous && this.status === "capturing") return;
    this.reconfiguring = true;
    this.setStatus("starting", message("capture.status.switchingAdapter"));
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
        this.setStatus("unavailable", message("capture.status.restartRequired"));
        throw new Error(`Could not switch capture adapter and restore the previous adapter: ${requestedError}`);
      }
    } finally {
      this.reconfiguring = false;
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    try {
      try {
        await this.commitTowerLocationTransition(false, false);
      } catch (error) {
        this.logCaptureError(errorMessage(error), "Tower location could not be committed before stopping");
      }
      const run = this.lifecycleChain.catch(() => {}).then(() => this.performStop());
      this.lifecycleChain = run.catch(() => {});
      await run;
    } finally {
      this.stopping = false;
    }
  }

  private async performStop(): Promise<void> {
    this.clearWriteMonitor();
    if (this.activeStatusTimer !== undefined) this.clock.clearTimeout(this.activeStatusTimer);
    this.activeStatusTimer = undefined;
    try {
      await this.capture.stop();
    } catch (error) {
      this.logCaptureError(errorMessage(error), "Capture could not stop cleanly");
    }
    this.writeStoppedLifecycle();
    if (this.minimapTimer !== undefined) this.clock.clearTimeout(this.minimapTimer);
    this.minimapTimer = undefined;
    this.resetTrackers("full");
    this.rewards.reset();
    this.rewardAttributor.reset();
    this.locallyDamagedRewardTargets.clear();
    this.lastLoggedLocation = undefined;
    this.pendingDirectWorldTransition = false;
    this.pendingCharacterBoundary = false;
    this.clearTowerLocationTimer();
    this.towerLocationDeadlineMs = undefined;
    this.clearPacketBuffer();
    this.targetState = "waiting";
    this.receivedDataForCurrentGame = false;
    this.health.reset();
    this.health.setTargetActive(false);
    this.activeConnectionId = undefined;
    this.lastClosedConnectionId = undefined;
    this.lastAuthenticated = undefined;
    this.sawAuthenticated = false;
    this.sawAdmittedTrafficBeforeAuthentication = false;
    this.diagnostics.clear();
    const session = this.session;
    this.session = undefined;
    this.combatLog = undefined;
    this.rewardsLog = undefined;
    this.otherLog = undefined;
    this.diagnostics.setLogger(undefined);
    try {
      await session?.close();
    } catch (error) {
      console.error("[spiritvale-logging]", errorMessage(error));
    }
    this.scheduleSessionFinalization(session);
    await this.summaryFinalization;
    this.setStatus("stopped", message("capture.status.stopped"));
  }

  async resetSession(): Promise<void> {
    if (this.towerLocationTimer !== undefined && await this.commitTowerLocationTransition(true)) return;
    return this.rotateSession();
  }

  /** Resolves after coordinator-triggered lifecycle work has finished. */
  async whenSettled(): Promise<void> {
    await this.resettingSession;
    await this.lifecycleChain;
  }

  private async rotateSession(seed?: SessionSeed): Promise<void> {
    if (this.resettingSession) return this.resettingSession;
    if (this.stopping) throw new Error("cannot reset the capture session while it is stopping");
    this.handoff = true;
    this.handoffFailure = undefined;
    const run = this.lifecycleChain.catch(() => {}).then(() => this.performResetSession(seed)).catch((error) => {
      this.reportError("Capture session could not be reset", errorMessage(error));
      throw error;
    });
    this.lifecycleChain = run.catch(() => {});
    const tracked = run.finally(() => {
      this.resettingSession = undefined;
      this.handoff = false;
      this.drainBufferedPackets();
    });
    this.resettingSession = tracked;
    return tracked;
  }

  private async performResetSession(seed?: SessionSeed): Promise<void> {
    const streams: LogStream[] = ["combat", "rewards"];
    if (this.diagnostics.enabled) streams.push("other");
    const seedIdentities = seed?.identities ?? this.actors.snapshot();
    const seedLocation = seed === undefined ? this.lastLoggedLocation : seed.location;

    const nextSession = await createLogSession({
      producer: "desktop-capture",
      streams,
      logDirectory: this.options.logDirectory,
      activate: false,
      maxBufferedBytes: CAPTURE_LOG_BUFFER_BYTES,
      onWriteError: (failure) => this.logWriteFailure(failure),
    });

    try {
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

      const previousSession = this.session;
      const rewardEvents = this.rewardAttributor.consume(
        this.rewards.flushSessionBoundary(),
        Number.POSITIVE_INFINITY,
      );
      this.rewardAttributor.reset();
      this.locallyDamagedRewardTargets.clear();
      if (seed?.resetRewards) this.rewards.reset();
      for (const event of rewardEvents) {
        this.rewardsLog?.log(event.kind === "kill" ? "rewards.kill" : "rewards.unmatched", jsonObject(event));
      }
      this.combatLog?.log("combat.lifecycle", { state: "stopped" });
      this.rewardsLog?.log("rewards.lifecycle", { state: "stopped" });
      this.otherLog?.log("capture.lifecycle", { state: "stopped" });

      this.combat.reset();
      this.loggedShortDisplayStatuses.clear();
      this.lastLoggedLocation = undefined;

      this.session = nextSession;
      this.combatLog = nextSession.logger("combat");
      this.rewardsLog = nextSession.logger("rewards");
      this.otherLog = this.diagnostics.enabled ? nextSession.logger("other") : undefined;
      this.diagnostics.setLogger(this.otherLog);

      for (const identity of seedIdentities) {
        this.combatLog.log("combat.actorIdentity", jsonObject({ kind: "actorIdentity", operation: "upsert", tick: 0, ...identity }));
      }
      if (seedLocation !== undefined) this.logLocation(seedLocation, 0);
      this.publishActiveStatuses(true);

      this.combatLog.log("combat.lifecycle", { state: "started" });
      this.rewardsLog.log("rewards.lifecycle", { state: "started" });
      this.otherLog?.log("capture.lifecycle", { state: "started" });

      await nextSession.flush();

      try {
        await previousSession?.close();
      } catch (error) {
        console.error("[spiritvale-logging]", errorMessage(error));
      }
      this.scheduleSessionFinalization(previousSession);
    } finally {
      // `handoff` stays set until resetSession releases its guard, alongside the buffer drain.
      const handoffFailure = this.handoffFailure;
      this.handoffFailure = undefined;
      if (handoffFailure) {
        this.clearPacketBuffer();
        throw handoffFailure;
      }
    }
  }

  private scheduleSessionFinalization(session: LogSession | undefined): void {
    if (!session || !this.options.onSessionEnded) return;
    this.summaryFinalization = this.summaryFinalization.then(async () => {
      try {
        await this.options.onSessionEnded?.(session.id);
      } catch (error) {
        console.error("[spiritvale-summary]", `session ${session.id}: ${errorMessage(error)}`);
      }
    });
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
        this.setStatus("unavailable", message("capture.status.resetOverrun"));
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
    this.otherLog?.log("capture.lifecycle", { state: "started" });
    this.publishCaptureDetail();
  }

  private targetStatus(target: CaptureTargetStatus): void {
    this.otherLog?.log("capture.targetStatus", {
      processName: target.processName,
      state: target.state,
      processIds: target.processIds,
    });
    const previousState = this.targetState;
    this.targetState = target.state;
    if (target.state === "waiting") {
      this.receivedDataForCurrentGame = false;
      this.health.reset();
      this.health.setTargetActive(false);
      if (!this.missingGameReported) {
        this.missingGameReported = true;
        this.reportError(
          "Game was not detected for capture",
          `${target.processName} was not found by Windows process inspection. The game may not be running, may still be starting, or process inspection may be blocked.`,
          { "Expected process": target.processName },
        );
      }
    } else {
      this.missingGameReported = false;
      if (previousState !== "active") {
        this.health.reset();
        this.health.setTargetActive(true);
      }
    }
    this.refreshCaptureDetail();
  }

  private captureWarning(message: string): void {
    this.health.observeCaptureWarning(message);
    this.combatLog?.log("combat.warning", { message });
    this.rewardsLog?.log("rewards.warning", { message });
    this.otherLog?.log("capture.warning", { message });
  }

  private captureError(error: Error): void {
    this.logCaptureError(error.message, "Packet capture stopped unexpectedly");
    if (!this.stopping) this.setStatus("unavailable", message("capture.status.restartRequired"));
  }

  private captureStopped(): void {
    if (this.reconfiguring) return;
    this.writeStoppedLifecycle();
    if (!this.stopping && this.status !== "unavailable") this.setStatus("stopped", message("capture.status.stopped"));
  }

  private startCapture(): Promise<void> {
    this.targetState = "waiting";
    this.receivedDataForCurrentGame = false;
    this.health.reset();
    this.health.setTargetActive(false);
    return this.capture.start({
      protocols: ["udp"],
      targetProcessName: gameProcessName,
      decodeFishNet: true,
      deviceName: this.options.deviceName,
    });
  }

  private routePacket(packet: CapturedFishNetPacket): void {
    this.health.observeFishNet();
    if (this.deferPacketDuringTransition(packet)) return;
    this.beginPacketDiagnostics(packet);
    const admission = this.consumePacketAdmission(packet);
    if (!admission) return;

    const towerChanged = this.consumeTowerLocation(packet);
    if (towerChanged === "deferred") return;
    this.countUnresolvedPacket(packet);
    this.logSplitDrop(packet);

    const loggedZone = this.logZone(packet);
    const directWorldLocation = directWorldTransition(packet);
    const characterBoundary = packet.rpcName === "QuitCharacter_Rpc";
    const transitionSeed = packet.packetName === "authenticated" && !admission.completedDirectTransition
      ? {}
      : undefined;
    let handled = admission.characterHandled
      || loggedZone
      || towerChanged
      || directWorldLocation !== undefined
      || characterBoundary;
    const combat = this.consumeCombatPacket(packet);
    handled ||= combat.handled;
    const rewardsHandled = this.consumeRewardsPacket(packet, combat.events);
    handled ||= rewardsHandled;

    if (!handled) this.diagnostics.logUnclassified(packet);
    if (directWorldLocation !== undefined) this.beginDirectWorldTransition(directWorldLocation, packet.tick);
    if (characterBoundary) this.beginCharacterBoundary(packet.tick);
    if (transitionSeed) this.resetOnMapChange(transitionSeed);
  }

  private deferPacketDuringTransition(packet: CapturedFishNetPacket): boolean {
    if (this.towerLocationTimer !== undefined) {
      if (packet.connectionId === this.activeConnectionId && isTowerStatePacket(packet)) {
        if (this.tower.consume(packet)) {
          this.pendingTowerLocationTick = packet.tick;
          this.scheduleTowerLocationCommit();
        }
        return true;
      }
      if (packet.connectionId === this.activeConnectionId) this.observePhysicalMap(packet);
      this.diagnostics.logPacketAdmission(packet, "buffered", "tower-location-settle", this.activeConnectionId);
      this.bufferHandoffPacket(packet);
      return true;
    }
    if (this.handoff) {
      this.diagnostics.logPacketAdmission(packet, "buffered", "capture-session-handoff", this.activeConnectionId);
      this.bufferHandoffPacket(packet);
      return true;
    }
    return false;
  }

  private beginPacketDiagnostics(packet: CapturedFishNetPacket): void {
    if (packet.packetName === "authenticated") this.diagnostics.beginTransition(packet);
    if (isStatusPacket(packet)) this.diagnostics.logStatusPacket(packet, "input");
    if (!this.receivedDataForCurrentGame) {
      this.receivedDataForCurrentGame = true;
      this.refreshCaptureDetail();
    }
  }

  private consumePacketAdmission(packet: CapturedFishNetPacket): {
    characterHandled: boolean;
    completedDirectTransition: boolean;
  } | undefined {
    const admission = this.admitPacket(packet);
    if (admission.suppressBeforeAdmission) return undefined;
    const inspectHandled = this.inspected.consume(packet);
    let characterHandled = this.character.consumeBeforeAdmission(packet);
    if (!admission.accepted) return undefined;
    const completedDirectTransition = packet.packetName === "authenticated"
      && (this.pendingDirectWorldTransition || this.pendingCharacterBoundary);
    if (completedDirectTransition) {
      this.pendingDirectWorldTransition = false;
      this.pendingCharacterBoundary = false;
    }
    if (packet.packetName === "objectSpawn") {
      this.pendingDirectWorldTransition = false;
      this.pendingCharacterBoundary = false;
    }
    if (!this.sawAuthenticated
      && packet.packetName !== "authenticated"
      && packet.packetName !== "disconnect") {
      this.sawAdmittedTrafficBeforeAuthentication = true;
    }
    this.trackChannel(packet);
    const admittedCharacterHandled = this.character.consumeAdmitted(packet);
    characterHandled ||= admittedCharacterHandled || inspectHandled;
    return { characterHandled, completedDirectTransition };
  }

  private consumeTowerLocation(packet: CapturedFishNetPacket): boolean | "deferred" {
    const towerReset = packet.packetName === "authenticated" ? this.tower.reset() : false;
    if (packet.packetName === "authenticated") {
      this.lastObservedMapId = undefined;
      this.positions.reset();
      this.loot.reset();
      if (this.minimapEnabled()) this.publishMinimap(true);
    }
    const towerChanged = this.tower.consume(packet) || towerReset;
    if (towerChanged && isTowerStatePacket(packet)) {
      const location = this.effectiveLocation();
      if (!sameSpiritValeLocation(location, this.lastLoggedLocation)) {
        this.pendingTowerLocationTick = packet.tick;
        this.scheduleTowerLocationCommit();
        return "deferred";
      }
    }
    return towerChanged;
  }

  private logSplitDrop(packet: CapturedFishNetPacket): void {
    if (packet.splitDropReason !== undefined) {
      this.combatLog?.log("combat.warning", {
        message: `split reassembly dropped (${packet.splitDropReason}) at tick ${packet.tick}`,
      });
    }
  }

  private consumeCombatPacket(packet: CapturedFishNetPacket): {
    handled: boolean;
    events: FishNetCombatEvent[];
  } {
    try {
      this.mobs.consume(packet);
      let handled = this.consumeGravestone(packet);
      if (packet.packetName === "authenticated" || packet.packetName === "disconnect") {
        this.loggedMobIdentities.clear();
        this.reportedGravestones.clear();
      }
      const identities = this.actors.consume(packet);
      if (this.minimapEnabled() && this.positions.consume(packet).length > 0) this.scheduleMinimapPublish();
      const events = this.combat.consume(packet);
      if (isStatusPacket(packet)) {
        this.diagnostics.logStatusPacket(
          packet,
          "output",
          events.filter((event) => event.kind === "status"),
        );
      }
      for (const event of events) {
        if ((event.kind === "damage" || event.kind === "death") && event.team === 0) {
          identities.push(...this.actors.observePlayerActor(event.actorId, event.tick));
        }
        if (event.kind === "death" && event.team !== 0) {
          identities.push(...this.actors.observePlayerActor(event.targetId, event.tick));
        }
      }
      const observedAtMs = this.clock.now();
      for (const identity of identities) this.statusTracker.consumeIdentity(identity);
      for (const event of events) this.statusTracker.consume(event, observedAtMs);
      this.scheduleActiveStatusExpiry();
      handled ||= identities.length > 0 || events.length > 0;
      for (const event of identities) this.combatLog?.log("combat.actorIdentity", jsonObject(event));
      for (const event of events) if (event.actorId !== undefined) this.logMobIdentity(event.actorId, event.tick);
      for (const event of events) if (this.shouldLogCombatEvent(event)) this.combatLog?.log("combat.event", jsonObject(event));
      this.publishActiveStatuses();
      return { handled, events };
    } catch (error) {
      this.logDomainWarning("combat", error);
      return { handled: false, events: [] };
    }
  }

  private consumeRewardsPacket(packet: CapturedFishNetPacket, combatEvents: FishNetCombatEvent[]): boolean {
    try {
      const lootEvents = this.loot.consume(packet);
      if (this.minimapEnabled() && lootEvents.length > 0) this.scheduleMinimapPublish();
      this.emitLootToasts(lootEvents);
      const tracked = this.shouldTrackRewardPacket(combatEvents)
        ? this.rewards.consume(packet)
        : [];
      const events = this.rewardAttributor.consume(tracked, packet.tick);
      if (packet.packetName === "authenticated" || packet.packetName === "disconnect") {
        events.push(...this.rewardAttributor.flush());
        this.locallyDamagedRewardTargets.clear();
      }
      for (const event of events) {
        this.rewardsLog?.log(event.kind === "kill" ? "rewards.kill" : "rewards.unmatched", jsonObject(event));
      }
      return events.length > 0;
    } catch (error) {
      this.logDomainWarning("rewards", error);
      return false;
    }
  }

  private beginDirectWorldTransition(location: SpiritValeLocation & { kind: "map" }, tick: number): void {
    if (sameSpiritValeLocation(location, this.lastLoggedLocation)) return;
    this.pendingDirectWorldTransition = true;
    this.lastObservedMapId = location.mapId;
    this.options.onGoldMapChange?.();
    if (this.options.resetOnMapChange?.()) {
      void this.rotateSession({ location }).catch(() => {});
    } else {
      this.logLocation(location, tick);
    }
  }

  private beginCharacterBoundary(tick: number): void {
    this.pendingCharacterBoundary = true;
    this.pendingDirectWorldTransition = false;
    this.combatLog?.log("combat.actorIdentity", { kind: "actorIdentity", operation: "reset", tick });
    this.resetTrackers("character");
    this.options.onGoldMapChange?.();
    if (this.options.resetOnMapChange?.()) {
      void this.rotateSession({ identities: [], resetRewards: true }).catch(() => {});
    } else {
      this.rewards.reset();
      this.rewardAttributor.reset();
      this.locallyDamagedRewardTargets.clear();
    }
  }

  private resetOnMapChange(seed: SessionSeed): void {
    const initialLogin = !this.sawAuthenticated && !this.sawAdmittedTrafficBeforeAuthentication;
    this.sawAuthenticated = true;
    if (initialLogin) return;
    this.options.onGoldMapChange?.();
    if (!this.options.resetOnMapChange?.()) return;
    void this.rotateSession(seed).catch(() => {});
  }

  private countUnresolvedPacket(packet: CapturedFishNetPacket): void {
    if (packet.packetName === "rpcLink" && packet.linkResolved === false) {
      this.unresolvedCounts.set("rpcLink:unregistered", (this.unresolvedCounts.get("rpcLink:unregistered") ?? 0) + 1);
    } else if (packet.rpcResolution === "recovered") {
      this.unresolvedCounts.set("rpcLink:recovered", (this.unresolvedCounts.get("rpcLink:recovered") ?? 0) + 1);
    } else if (packet.rpcResolution === "ambiguous") {
      const key = `ambiguous:${packet.packetName}:hash=${packet.rpcHash}:component=${packet.networkBehaviourIndex}`;
      this.unresolvedCounts.set(key, (this.unresolvedCounts.get(key) ?? 0) + 1);
    } else {
      return;
    }
    const now = this.clock.now();
    this.unresolvedReportedAtMs ||= now;
    if (now - this.unresolvedReportedAtMs < UNRESOLVED_REPORT_INTERVAL_MS) return;
    const summary = [...this.unresolvedCounts.entries()]
      .sort(([, left], [, right]) => right - left)
      .slice(0, UNRESOLVED_REPORT_ENTRIES)
      .map(([key, count]) => `${key}=${count}`)
      .join(", ");
    this.combatLog?.log("combat.warning", {
      message: `unattributed packets in the last ${Math.round((now - this.unresolvedReportedAtMs) / 1000)}s: ${summary}`,
    });
    this.unresolvedCounts.clear();
    this.unresolvedReportedAtMs = now;
  }

  private logCharacterWarning(packet: CapturedFishNetPacket, error: unknown): void {
    this.otherLog?.log("capture.warning", {
      domain: "character",
      message: `skipped character payload: ${errorMessage(error)}`,
      rpcName: packet.rpcName ?? null,
      objectId: packet.objectId ?? null,
      payloadHex: packet.payload.subarray(0, SPAWN_PAYLOAD_LOG_LIMIT).toString("hex"),
      payloadBytes: packet.payload.length,
    });
  }

  private localHealingTraits(): { hasSiphonHealth: boolean; hasHealthLeech: boolean } | undefined {
    const snapshot = this.character.current();
    return snapshot ? resolveCharacterHealingTraits(snapshot) : undefined;
  }

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
    if (actorId === this.character.physicalObjectId()) return true;
    const characterName = this.character.current()?.name;
    if (characterName === undefined) return false;
    const attributed = this.actors.getAttribution(actorId)?.displayName;
    return attributed !== undefined && normalizeName(attributed) === normalizeName(characterName);
  }

  private logMobIdentity(actorId: number, tick: number): void {
    const mob = this.mobs.get(actorId);
    if (!mob) return;
    const fingerprint = `${mob.mobId}\u0000${mob.level}\u0000${mob.displayName}`;
    if (this.loggedMobIdentities.get(actorId) === fingerprint) return;
    this.loggedMobIdentities.set(actorId, fingerprint);
    this.combatLog?.log("combat.event", jsonObject({
      kind: "activation",
      tick,
      actorId,
      sourceId: `__spiritvaleMobIdentity:${mob.mobId}`,
      sourceLabel: mob.displayName,
      level: mob.level,
    }));
  }

  private trackChannel(packet: CapturedFishNetPacket): void {
    if (packet.packetName === "authenticated" || packet.packetName === "disconnect") {
      this.currentChannel = undefined;
      this.setServerInstance(undefined);
      return;
    }
    if (packet.rpcName !== "ChannelList_T") return;
    const channel = channelFromIndex(packet, "currentIndex");
    if (channel === undefined) return;
    this.currentChannel = channel;
    const instanceId = packet.decodedFields?.find((field) => field.name === "instanceId")?.value;
    this.setServerInstance(typeof instanceId === "string" && instanceId.length > 0 ? instanceId : undefined);
  }

  private setServerInstance(instanceId: string | undefined): void {
    if (instanceId === this.currentInstanceId) return;
    this.currentInstanceId = instanceId;
    this.options.onServerInstance?.(instanceId);
  }

  private logZone(packet: CapturedFishNetPacket): boolean {
    const mapId = this.observePhysicalMap(packet);
    if (mapId === undefined) return false;
    const location = this.effectiveLocation();
    if (location === undefined || sameSpiritValeLocation(this.lastLoggedLocation, location)) return true;
    this.logLocation(location, packet.tick);
    return true;
  }

  private observePhysicalMap(packet: CapturedFishNetPacket): number | undefined {
    const localObjectId = this.character.physicalObjectId();
    const localTarget = packet.rpcName === LOCAL_TARGET_MAP_RPC;
    const localObjectBroadcast = packet.rpcName !== undefined
      && OBJECT_MAP_RPC_NAMES.has(packet.rpcName)
      && localObjectId !== undefined
      && packet.objectId === localObjectId;
    if (!localTarget && !localObjectBroadcast) return undefined;
    const mapId = packet.decodedFields?.find((field) => field.name === "mapId")?.value;
    if (typeof mapId !== "number" || !Number.isSafeInteger(mapId) || mapId < 0) return undefined;
    this.lastObservedMapId = mapId;
    return mapId;
  }

  private effectiveLocation(): SpiritValeLocation | undefined {
    const tower = this.tower.current();
    if (tower.inTower) return { ...(tower.floor === undefined ? {} : { floor: tower.floor }), kind: "eternalTower" };
    return this.lastObservedMapId === undefined ? undefined : { kind: "map", mapId: this.lastObservedMapId };
  }

  private logLocation(location: SpiritValeLocation, tick: number): void {
    this.lastLoggedLocation = location;
    this.combatLog?.log("combat.event", {
      kind: "activation",
      tick,
      actorId: 0,
      sourceId: location.kind === "map"
        ? `${ZONE_EVENT_SOURCE_PREFIX}${location.mapId}`
        : `${TOWER_FLOOR_EVENT_SOURCE_PREFIX}${location.floor ?? TOWER_FLOOR_UNKNOWN_SUFFIX}`,
      sourceLabel: location.kind === "map"
        ? `Zone ${location.mapId}`
        : location.floor === undefined ? "Eternal Tower" : `Eternal Tower - Floor ${location.floor}`,
    });
  }

  private scheduleTowerLocationCommit(): void {
    this.towerLocationDeadlineMs ??= this.clock.now() + TOWER_LOCATION_MAX_SETTLE_MS;
    const delay = Math.max(0, Math.min(TOWER_LOCATION_SETTLE_MS, this.towerLocationDeadlineMs - this.clock.now()));
    this.clearTowerLocationTimer();
    this.towerLocationTimer = this.clock.setTimeout(async () => {
      await this.commitTowerLocationTransition().catch((error) => {
        this.reportError("Tower location could not be committed", errorMessage(error));
      });
    }, delay);
  }

  private clearTowerLocationTimer(): void {
    if (this.towerLocationTimer !== undefined) this.clock.clearTimeout(this.towerLocationTimer);
    this.towerLocationTimer = undefined;
  }

  private async commitTowerLocationTransition(forceRotation = false, allowSideEffects = true): Promise<boolean> {
    if (this.towerLocationTimer === undefined) return false;
    this.clearTowerLocationTimer();
    this.towerLocationDeadlineMs = undefined;
    const location = this.effectiveLocation();
    const changed = location !== undefined && !sameSpiritValeLocation(location, this.lastLoggedLocation);
    if (changed && allowSideEffects) this.options.onGoldMapChange?.();
    const shouldRotate = allowSideEffects
      && location !== undefined
      && (forceRotation || (changed && this.options.resetOnMapChange?.()));
    if (shouldRotate) {
      await this.rotateSession({ location });
      return true;
    }
    const handoffFailure = this.handoffFailure;
    this.handoffFailure = undefined;
    if (handoffFailure) {
      this.clearPacketBuffer();
      throw handoffFailure;
    }
    if (changed && location !== undefined) this.logLocation(location, this.pendingTowerLocationTick);
    this.drainBufferedPackets();
    return false;
  }

  private activeStatuses(nowMs = this.clock.now()): FishNetActiveStatus[] {
    this.statusTracker.advance(nowMs);
    const actorId = this.character.physicalObjectId();
    return actorId === undefined ? [] : this.statusTracker.getActiveStatuses(actorId, nowMs);
  }

  private publishActiveStatuses(force = false): void {
    const nowMs = this.clock.now();
    const statuses = this.activeStatuses(nowMs);
    const actorId = this.character.physicalObjectId();
    if (!force
      && this.lastPublishedStatusRevision === this.statusTracker.revision
      && this.lastPublishedStatusActorId === actorId) return;
    this.lastPublishedStatusRevision = this.statusTracker.revision;
    this.lastPublishedStatusActorId = actorId;
    for (const listener of this.activeStatusListeners) listener(statuses);
    this.scheduleActiveStatusExpiry();
  }

  private scheduleActiveStatusExpiry(): void {
    if (this.activeStatusTimer !== undefined) this.clock.clearTimeout(this.activeStatusTimer);
    this.activeStatusTimer = undefined;
    const expiresAtMs = this.statusTracker.nextExpiryAtMs();
    if (expiresAtMs === undefined) return;
    this.activeStatusTimer = this.clock.setTimeout(() => {
      this.activeStatusTimer = undefined;
      this.publishActiveStatuses();
    }, Math.max(0, expiresAtMs - this.clock.now()));
    this.activeStatusTimer.unref?.();
  }

  private minimapState(): CaptureMinimapState {
    return { self: this.positions.self(), loot: this.loot.active() };
  }

  private minimapEnabled(): boolean {
    return this.options.minimapEnabled?.() ?? true;
  }

  private emitLootToasts(events: readonly FishNetLootDropEvent[]): void {
    if (this.lootToastListeners.size === 0) return;
    const threshold = this.options.getMinimapRarityFilter?.() ?? 0;
    const chanceThreshold = this.options.getMinimapLootChanceFilter?.() ?? 100;
    for (const event of events) {
      if (event.kind === "removed" || this.toastedLootIds.has(event.drop.objectId)) continue;
      if (event.drop.displayName === undefined || (event.drop.rarity ?? 0) < threshold) continue;
      if ((event.drop.lootChance ?? 0) > chanceThreshold) continue;
      this.toastedLootIds.add(event.drop.objectId);
      const toast: CaptureLootToastEvent = {
        objectId: event.drop.objectId,
        displayName: event.drop.displayName,
        ...(event.drop.rarity === undefined ? {} : { rarity: event.drop.rarity }),
        ...(event.drop.spriteId === undefined ? {} : { spriteId: event.drop.spriteId }),
        ...(event.drop.lootChance === undefined ? {} : { lootChance: event.drop.lootChance }),
      };
      for (const listener of this.lootToastListeners) listener(toast);
    }
  }

  private scheduleMinimapPublish(): void {
    if (this.minimapTimer !== undefined) return;
    this.minimapTimer = this.clock.setTimeout(() => {
      this.minimapTimer = undefined;
      this.publishMinimap();
    }, MINIMAP_PUBLISH_MS);
    this.minimapTimer.unref?.();
  }

  private publishMinimap(force = false): void {
    const state = this.minimapState();
    const json = JSON.stringify(state);
    if (!force && json === this.lastPublishedMinimapJson) return;
    this.lastPublishedMinimapJson = json;
    for (const listener of this.minimapListeners) listener(state);
  }

  private shouldLogCombatEvent(event: FishNetCombatEvent): boolean {
    const isShortDisplayRefresh = event.kind === "status"
      && event.rpc === "ApplyEffectDisplays_O"
      && event.action === "applied"
      && event.remainingSeconds !== undefined
      && event.remainingSeconds >= 0
      && event.remainingSeconds <= 5;
    if (!isShortDisplayRefresh) {
      if (event.kind === "status" && event.action === "removed") {
        this.loggedShortDisplayStatuses.delete(`${event.actorId}\u0000${event.statusId}`);
      }
      return true;
    }
    const key = `${event.actorId}\u0000${event.statusId}`;
    if (this.loggedShortDisplayStatuses.has(key)) return false;
    this.loggedShortDisplayStatuses.add(key);
    return true;
  }

  private admitPacket(packet: CapturedFishNetPacket): PacketAdmission {
    const connectionId = packet.connectionId;
    const activeBefore = this.activeConnectionId;
    if (activeBefore === undefined && connectionId === this.lastClosedConnectionId) {
        this.diagnostics.logPacketAdmission(packet, "rejected", "closed-connection", activeBefore);
      return { accepted: false, suppressBeforeAdmission: false };
    }
    if (activeBefore === undefined) this.setActiveConnection(connectionId);
    if (connectionId !== this.activeConnectionId) {
      if (packet.packetName !== "authenticated") {
      this.diagnostics.logPacketAdmission(packet, "rejected", "inactive-connection", activeBefore);
        return { accepted: false, suppressBeforeAdmission: false };
      }
      this.setActiveConnection(connectionId);
    }
    if (packet.packetName === "authenticated") {
      if (this.lastAuthenticated?.connectionId === connectionId && this.lastAuthenticated.tick === packet.tick) {
        this.diagnostics.logPacketAdmission(packet, "rejected", "duplicate-authenticated", activeBefore);
        return { accepted: false, suppressBeforeAdmission: true };
      }
      if (activeBefore === connectionId && this.lastAuthenticated?.connectionId === connectionId) {
        this.lastAuthenticated = { connectionId, tick: packet.tick };
        this.diagnostics.logPacketAdmission(packet, "rejected", "same-connection-reauthenticated", activeBefore);
        return { accepted: false, suppressBeforeAdmission: true };
      }
      this.lastAuthenticated = { connectionId, tick: packet.tick };
    }
    if (packet.packetName === "disconnect") {
      this.lastClosedConnectionId = connectionId;
      this.setActiveConnection(undefined);
    }
    if (packet.packetName === "authenticated" || packet.packetName === "disconnect" || isStatusPacket(packet)) {
      this.diagnostics.logPacketAdmission(packet, "accepted", undefined, activeBefore);
    }
    return { accepted: true, suppressBeforeAdmission: false };
  }

  private syncLocalActorIdentity(): void {
    this.positions.setLocalObjectId(this.character.physicalObjectId());
    const snapshot = this.character.current();
    // Inspecting yourself replies on the same RPC, so the roster needs your name to exclude it.
    this.inspected.setLocalName(snapshot?.name);
    if (!snapshot) return;
    const archetype = this.character.currentArchetypeId();
    this.actors.setLocalIdentity({
      displayName: snapshot.name,
      ...(archetype === undefined ? {} : { archetype }),
    });
  }

  private logDomainWarning(domain: "combat" | "rewards", error: unknown): void {
    const message = `skipped ${domain} payload: ${errorMessage(error)}`;
    if (domain === "combat") this.combatLog?.log("combat.warning", { message });
    else this.rewardsLog?.log("rewards.warning", { message });
    this.otherLog?.log("capture.warning", { domain, message });
  }

  private logCaptureError(message: string, title = "Capture failed"): void {
    this.combatLog?.log("combat.error", { message });
    this.rewardsLog?.log("rewards.error", { message });
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

  private logWriteFailure(failure: LogWriteFailure): void {
    console.error("[spiritvale-logging]", `${failure.stream}: ${failure.error.message}`);
    this.reportError("Capture logs could not be written", failure.error.message, {
      "Affected log": failure.stream,
    });
    if (this.stopping) return;
    if (this.status !== "unavailable") this.setStatus("unavailable", message("capture.status.logWriteFailed"));
    this.watchForDroppedRecords();
  }

  private watchForDroppedRecords(): void {
    if (this.writeMonitor || this.stopping) return;
    this.writeMonitor = this.clock.setInterval(() => {
      if (this.stopping) {
        this.clearWriteMonitor();
        return;
      }
      if (this.droppedRecords() === 0) return;
      this.clearWriteMonitor();
      this.setStatus("unavailable", message("capture.status.logWriteStopped"));
      void this.capture.stop().catch((error) => console.error("[spiritvale-capture]", errorMessage(error)));
    }, WRITE_MONITOR_INTERVAL_MS);
    this.writeMonitor.unref?.();
  }

  private clearWriteMonitor(): void {
    if (!this.writeMonitor) return;
    this.clock.clearInterval(this.writeMonitor);
    this.writeMonitor = undefined;
  }

  private droppedRecords(): number {
    return [this.combatLog, this.rewardsLog, this.otherLog]
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
    this.otherLog?.log("capture.lifecycle", { state: "stopped" });
  }

  private setStatus(status: CaptureStatus, statusDetail: LocalizedText): void {
    if (this.status === status && sameLocalizedText(this.statusDetail, statusDetail)) return;
    this.status = status;
    this.statusDetail = statusDetail;
    this.options.onStatus?.(this.state());
  }

  private refreshCaptureDetail(): void {
    if (this.status !== "capturing") return;
    this.publishCaptureDetail();
  }

  private publishCaptureHealthChange(): void {
    const previousStatus = this.status;
    const previousDetail = this.statusDetail;
    this.refreshCaptureDetail();
    if (this.status === previousStatus && sameLocalizedText(this.statusDetail, previousDetail)) {
      this.options.onStatus?.(this.state());
    }
  }

  private publishCaptureDetail(): void {
    const detail = this.captureDetail();
    this.setStatus("capturing", detail);
  }

  private captureDetail(): LocalizedText {
    if (this.targetState === "waiting") return GAME_NOT_RUNNING_DETAIL;
    if (!this.receivedDataForCurrentGame) return WAITING_FOR_DATA_DETAIL;
    const warning = this.health.warning();
    if (warning) return message(`capture.warning.${warning.code}`);
    return CAPTURE_ACTIVE_DETAIL;
  }

  private reportWarning(
    title: string,
    reason: string,
    details?: Readonly<Record<string, string | number | boolean | undefined>>,
  ): void {
    try {
      this.options.onWarning?.({ title, reason, ...(details === undefined ? {} : { details }) });
    } catch (error) {
      console.error("[spiritvale-warning-log]", errorMessage(error));
    }
  }
}

function isStatusPacket(packet: CapturedFishNetPacket): boolean {
  return packet.rpcName !== undefined && STATUS_RPC_NAMES.has(packet.rpcName);
}

function isTowerStatePacket(packet: CapturedFishNetPacket): boolean {
  return packet.rpcName === "DrawTitle" || packet.rpcName === "ClientInstancedMapReady";
}

function directWorldTransition(packet: CapturedFishNetPacket): (SpiritValeLocation & { kind: "map" }) | undefined {
  if (packet.packetName !== "serverRpc" || packet.networkBehaviourType !== "PlayerSave"
    || packet.rpcName !== "WarpWaypoint_S") return undefined;
  const mapId = packet.decodedFields?.find((field) => field.name === "mapId")?.value;
  return typeof mapId === "number" && Number.isSafeInteger(mapId) && mapId >= 0
    ? { kind: "map", mapId }
    : undefined;
}

function channelFromIndex(packet: CapturedFishNetPacket, fieldName: string): number | undefined {
  const index = packet.decodedFields?.find((field) => field.name === fieldName)?.value;
  if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) return undefined;
  return index + 1;
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
