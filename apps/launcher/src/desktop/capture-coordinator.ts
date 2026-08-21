import {
  FishNetActorDirectory,
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
import { FishNetEternalTowerTracker } from "@kar-mi/spirit-vale-tools-capture";
import type { CapturedFishNetPacket, CapturedLiteNetLibPacket, CaptureTargetStatus } from "@kar-mi/spirit-vale-tools-capture";
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
import { FishNetLootDropTracker, FishNetMobDirectory, FishNetMobRewardTracker, mobDefinitionsById } from "@kar-mi/spirit-vale-tools-rewards";
import type { FishNetLootDrop, FishNetLootDropEvent } from "@kar-mi/spirit-vale-tools-rewards";
import { TOWER_FLOOR_EVENT_SOURCE_PREFIX, ZONE_EVENT_SOURCE_PREFIX } from "@svoverlay/combat/zone-log";
import { sameSpiritValeLocation, type SpiritValeLocation } from "@svoverlay/desktop-platform/location";

import type { CaptureStatus, LauncherState } from "../launcher/types.ts";
import { decodeBossGravestone } from "./boss-gravestone.ts";
import type { BossGravestoneObservation } from "./boss-timer-coordinator.ts";
import { LocalCharacterRouter } from "./local-character-router.ts";
import { RewardEventAttributor } from "./reward-event-attributor.ts";

const SPAWN_PAYLOAD_LOG_LIMIT = 2_048;
const HANDOFF_PACKET_LIMIT = 4_096;
const HANDOFF_BYTE_LIMIT = 16 * 1024 * 1024;
const CAPTURE_LOG_BUFFER_BYTES = 1024 * 1024 * 1024;
const WRITE_MONITOR_INTERVAL_MS = 5_000;
const UNRESOLVED_REPORT_INTERVAL_MS = 60_000;
const UNRESOLVED_REPORT_ENTRIES = 5;
const DIAGNOSTIC_PRE_AUTH_MS = 5_000;
const DIAGNOSTIC_POST_AUTH_MS = 10_000;
const DIAGNOSTIC_PRE_AUTH_BYTE_LIMIT = 8 * 1024 * 1024;
const DIAGNOSTIC_TRANSITION_BYTE_LIMIT = 32 * 1024 * 1024;
const TOWER_LOCATION_SETTLE_MS = 500;
/** Position/loot updates arrive on nearly every packet during movement; coalesced to this cadence. */
const MINIMAP_PUBLISH_MS = 60;
const TOWER_LOCATION_MAX_SETTLE_MS = 2_000;
const STATUS_RPC_NAMES = new Set([
  "ApplyEffect_T",
  "RemoveEffect_T",
  "ApplyEffectDisplays_O",
  "ApplySkillDisplay_O",
  "RemoveSkillDisplay_O",
]);
const MAP_RPC_NAMES = new Set(["TraverseActive", "TraverseObservers", "SyncInstanceState"]);
const GAME_NOT_RUNNING_DETAIL = "Capture Active - Game not running";
const WAITING_FOR_DATA_DETAIL = "Capture Active - Waiting on data (change channel/map if recently launched).";
const CAPTURE_ACTIVE_DETAIL = "Capture Active";
type CaptureCoordinatorState = Pick<LauncherState, "captureStatus" | "statusDetail">;

interface SessionSeed {
  identities?: readonly FishNetActorIdentity[];
  location?: SpiritValeLocation;
}

/** The local player's position and the ground loot currently believed to be on the map. */
export interface CaptureMinimapState {
  self: FishNetPosition | undefined;
  loot: FishNetLootDrop[];
}

/** A single ground-loot drop that just spawned, forwarded as a discrete notification event. */
export interface CaptureLootToastEvent {
  objectId: number;
  displayName?: string;
  rarity?: number;
  spriteId?: string;
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
  /**
   * Read before every map/channel change to decide whether to rotate the capture session there.
   * A live getter rather than a value so toggling the setting takes effect without a restart.
   */
  resetOnMapChange?: () => boolean;
  /**
   * Invoked on every map/channel change (never the initial login), independent of
   * `resetOnMapChange` — the gold reset is a separate, unrelated setting.
   */
  onGoldMapChange?: () => void;
  /**
   * Read on every packet to decide whether to track/publish minimap position and loot data at all.
   * Defaults to enabled. A live getter so users experiencing lag can turn it off without a restart.
   */
  minimapEnabled?: () => boolean;
  /**
   * Read on every loot spawn to decide whether it clears the bar for a toast notification. Shares
   * the minimap's own rarity filter rather than a separate setting. Defaults to showing everything.
   */
  getMinimapRarityFilter?: () => number;
  /** Invoked when the marker left where a world boss died comes into view, for the respawn timers. */
  onBossGravestone?: (gravestone: BossGravestoneObservation) => void;
  /**
   * Invoked whenever the server instance the player is on changes, including to undefined while a
   * reconnection is in flight. Drives the region a manual timer defaults to and the region tab the
   * overlay opens on.
   */
  onServerInstance?: (instanceId: string | undefined) => void;
}

export class CaptureCoordinator {
  private readonly capture: PacketCapture;
  private readonly diagnosticLogging: boolean;
  private readonly actors: FishNetActorDirectory;
  private readonly combat = new FishNetCombatTracker({
    actorIdentityResolver: (actorId) => this.actors.getAttribution(actorId),
    healingTraitsResolver: (actorId: number) => {
      return actorId === this.character.physicalObjectId() ? this.localHealingTraits() : undefined;
    },
    // Attributes a summon calibration recovered from an unnamed packet. Those carry no object id of
    // their own, and CalibrateSummons_T is a targetRpc no other client receives, so the local
    // character is the only possible recipient.
    localActorIdResolver: () => this.character.physicalObjectId(),
    // Names each hit's target from the monster's spawn packet. The combat log carries no spawn
    // packets, so a name not stamped onto the event here cannot be recovered when the log is
    // replayed — which is why enemies that died without acting indexed as "Enemy <id>".
    monsterCatalog: mobDefinitionsById(),
  });
  /**
   * Live status state is deliberately independent of combat.jsonl. The display feed refreshes
   * some permanent effects every second, and retaining that chatter on disk serves neither the
   * overlay nor replay diagnostics.
   */
  private readonly statusTracker = new FishNetStatusTracker();
  private readonly activeStatusListeners = new Set<(statuses: readonly FishNetActiveStatus[]) => void>();
  private activeStatusTimer?: ReturnType<typeof setTimeout>;
  private lastPublishedStatusRevision = -1;
  private lastPublishedStatusActorId: number | undefined;
  /** One persisted sample per short display-feed status activation. */
  private readonly loggedShortDisplayStatuses = new Set<string>();
  private readonly rewards = new FishNetMobRewardTracker();
  private readonly tower = new FishNetEternalTowerTracker();
  private readonly rewardAttributor = new RewardEventAttributor();
  private readonly locallyDamagedRewardTargets = new Set<number>();
  private readonly unresolvedCounts = new Map<string, number>();
  private unresolvedReportedAtMs = 0;
  private readonly mobs = new FishNetMobDirectory();
  /** Assigned in the constructor: it needs `this.actors`, which is itself constructor-assigned. */
  private readonly positions: FishNetPositionTracker;
  private readonly loot = new FishNetLootDropTracker();
  private readonly minimapListeners = new Set<(state: CaptureMinimapState) => void>();
  private minimapTimer?: ReturnType<typeof setTimeout>;
  private lastPublishedMinimapJson?: string;
  private readonly lootToastListeners = new Set<(event: CaptureLootToastEvent) => void>();
  /** Object ids already toasted this session, so a later `update` for the same drop does not repeat it. */
  private readonly toastedLootIds = new Set<number>();
  private readonly character = new LocalCharacterRouter({
    onHandled: () => this.syncLocalActorIdentity(),
    onError: (packet, error) => this.logCharacterWarning(packet, error),
  });
  /**
   * Characters seen by inspecting other players. Kept apart from `character` on purpose: that
   * router owns the LOCAL player and merges every payload it accepts, so an inspected stranger
   * routed through it would overwrite your own character.
   */
  // SQLite is the durable roster and no longer has the old 24-player ceiling. Keep this intake
  // collector unbounded too, so its roster publication never drops an inspect before desktop
  // persistence receives it.
  private readonly inspected = new FishNetInspectRoster(Number.POSITIVE_INFINITY);
  private session?: LogSession;
  private combatLog?: JsonLinesLogger;
  private rewardsLog?: JsonLinesLogger;
  private otherLog?: JsonLinesLogger;
  private status: CaptureStatus = "stopped";
  private statusDetail = "Capture stopped";
  private stopping = false;
  private reconfiguring = false;
  private lifecycleStopped = false;
  private targetState: CaptureTargetStatus["state"] = "waiting";
  private missingGameReported = false;
  private receivedDataForCurrentGame = false;
  private hasReceivedCaptureData = false;
  private waitingForDataReported = false;
  private activeConnectionId?: string;
  private lastAuthenticated?: { connectionId: string; tick: number };
  private sawAuthenticated = false;
  /** Distinguishes a cold login from attaching capture to an already connected game session. */
  private sawAdmittedTrafficBeforeAuthentication = false;
  private diagnosticLiteNetBuffer: Array<{ capturedAtMs: number; bytes: number; data: JsonObject }> = [];
  private diagnosticLiteNetBufferBytes = 0;
  private diagnosticLiteNetDropped = 0;
  private diagnosticTransitionId = 0;
  private diagnosticTransitionUntilMs = 0;
  private diagnosticTransitionBytes = 0;
  private diagnosticTransitionTruncated = false;
  private resettingSession?: Promise<void>;
  private handoff = false;
  private packetBuffer: CapturedFishNetPacket[] = [];
  private packetBufferBytes = 0;
  private handoffFailure?: Error;
  private writeMonitor?: ReturnType<typeof setInterval>;
  private readonly loggedMobIdentities = new Map<number, string>();
  /** Last effective location written to this session; traversal packets repeat per observer. */
  private lastLoggedLocation: SpiritValeLocation | undefined;
  /** Latest physical map remains the destination when the authoritative tower snapshot clears. */
  private lastObservedMapId: number | undefined;
  private towerLocationTimer?: ReturnType<typeof setTimeout>;
  private towerLocationDeadlineMs?: number;
  private pendingTowerLocationTick = 0;
  /**
   * The in-game channel the local player is currently on.
   *
   * Cleared on every (re)authentication: both channel switches and map changes re-authenticate,
   * and either may land on a different channel, so the old reading is stale until the new
   * connection reports one of its own. Everything observed in between carries no channel rather
   * than the wrong one.
   */
  private currentChannel: number | undefined;
  /** Server instance the channel list last reported, e.g. `na3-12`; the region is derived from it. */
  private currentInstanceId: string | undefined;
  /**
   * Gravestones already reported, keyed by object id, so re-approaching one does not re-report it.
   *
   * The fingerprint includes where we believed we were, not just which death the marker records.
   * A marker noticed in the seconds before the channel list arrives is reported with no channel and
   * no instance; keying on the death alone would make that first, least informed sighting the only
   * one that ever counted, permanently stranding the timer in the "unknown" bucket. Including the
   * location means the next sighting re-reports and corrects it, and repeats settle once the
   * reading stops changing.
   */
  private readonly reportedGravestones = new Map<number, string>();
  /** Serializes stop() and resetSession() so their bodies never interleave. */
  private lifecycleChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: CaptureCoordinatorOptions) {
    this.actors = new FishNetActorDirectory({
      ...(options.knownIdentities === undefined ? {} : { knownIdentities: options.knownIdentities }),
      ...(options.onIdentityLearned === undefined ? {} : { onIdentityLearned: options.onIdentityLearned }),
    });
    this.positions = new FishNetPositionTracker({ directory: this.actors });
    this.diagnosticLogging = options.diagnosticLogging ?? envFlag(Bun.env["SPIRIT_VALE_DIAGNOSTIC_LOGS"]);
    this.capture = options.captureFactory?.() ?? new PacketCapture();
    this.capture.on("started", () => this.captureStarted());
    this.capture.on("targetStatus", (target) => this.targetStatus(target));
    this.capture.on("warning", (message) => this.captureWarning(message));
    this.capture.on("error", (error) => this.captureError(error));
    if (this.diagnosticLogging) {
      this.capture.on("liteNetPacket", (packet) => this.captureLiteNetDiagnostic(packet));
    }
    this.capture.on("fishNetPacket", (packet) => this.routePacket(packet));
    this.capture.on("stopped", () => this.captureStopped());
  }

  state(): CaptureCoordinatorState {
    return { captureStatus: this.status, statusDetail: this.statusDetail };
  }

  characterState(): CharacterViewState { return this.character.state(); }

  /** The server instance the player is currently on, e.g. `na3-12`. Undefined until one is seen. */
  currentServerInstance(): string | undefined { return this.currentInstanceId; }

  /**
   * Reports the marker the server spawns where a world boss died, and says whether this packet was
   * one.
   *
   * This is the only thing that starts a timer automatically, and deliberately so. Watching for a
   * boss's death event was tried and removed: the same catalog id spawns as a Summoner's or
   * Necromancer's pet, and the only thing separating the two on the wire is the level, which fails
   * silently whenever a pet's owner happens to be the boss's catalog level. A marker is proof —
   * the server only leaves one where a world boss really died — so there is nothing to second-guess.
   *
   * It is also strictly better informed. A death event dates a kill at the moment we noticed it and
   * only if we were watching; a gravestone carries the server's own time of death, stands afterwards,
   * and re-announces itself whenever a player comes near, so it dates a kill nobody here saw. Every
   * case a death event could have caught is one where the player was standing at the very spot the
   * marker then appeared.
   *
   * The channel rule still applies, because a boss raised from a summoning item leaves a marker too
   * and only resets the rotation on a channel that runs one.
   *
   * The same gravestone re-spawns into view every time the player approaches it, so a sighting is
   * dropped when it would say exactly what the last one did — the same death seen from the same
   * place. A sighting that has something new to say is reported: a marker noticed in the seconds
   * before the channel list arrives can only name the death, and passing it again once capture
   * knows where we are is what files the timer properly. The coordinator, not this, decides what
   * happens to the placeless one it already recorded.
   */
  private consumeGravestone(packet: CapturedFishNetPacket): boolean {
    if (packet.packetName !== "objectSpawn" || packet.objectId === undefined) return false;
    const gravestone = decodeBossGravestone(packet.payload, Date.now());
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

  /**
   * Subscribes the overlay to the local player's authoritative live status snapshot. The callback
   * is invoked immediately so opening/reopening the overlay does not wait for another refresh.
   */
  subscribeActiveStatuses(listener: (statuses: readonly FishNetActiveStatus[]) => void): () => void {
    this.activeStatusListeners.add(listener);
    listener(this.activeStatuses());
    return () => this.activeStatusListeners.delete(listener);
  }

  /**
   * Subscribes to the local player's position and the ground loot currently on the map, coalesced
   * onto {@link MINIMAP_PUBLISH_MS} rather than published per packet. The callback is invoked
   * immediately so opening the minimap does not wait for the next change.
   */
  subscribeMinimap(listener: (state: CaptureMinimapState) => void): () => void {
    this.minimapListeners.add(listener);
    listener(this.minimapState());
    return () => this.minimapListeners.delete(listener);
  }

  /** Notified once per ground-loot spawn that clears the minimap's rarity filter. No initial replay. */
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
    this.setStatus("starting", "Starting centralized capture…");
    try {
      if (!this.session) {
        const streams: LogStream[] = ["combat", "rewards"];
        if (this.diagnosticLogging) streams.push("other");
        this.session = await createLogSession({
          producer: "desktop-capture",
          streams,
          logDirectory: this.options.logDirectory,
          maxBufferedBytes: CAPTURE_LOG_BUFFER_BYTES,
          onWriteError: (failure) => this.logWriteFailure(failure),
        });
        this.combatLog = this.session.logger("combat");
        this.rewardsLog = this.session.logger("rewards");
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
    try {
      // A pending tower transition is flushed so its zone still reaches the log, but a failed flush
      // must not abort the teardown below: leaving timers, monitors and the log session open would
      // also leave `stopping` latched, which makes every later stop() a no-op.
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
    if (this.activeStatusTimer !== undefined) clearTimeout(this.activeStatusTimer);
    this.activeStatusTimer = undefined;
    try {
      await this.capture.stop();
    } catch (error) {
      this.logCaptureError(errorMessage(error), "Capture could not stop cleanly");
    }
    this.writeStoppedLifecycle();
    this.actors.reset();
    this.combat.reset();
    this.statusTracker.reset();
    this.loggedShortDisplayStatuses.clear();
    this.publishActiveStatuses(true);
    this.rewards.reset();
    this.rewardAttributor.reset();
    this.locallyDamagedRewardTargets.clear();
    this.mobs.reset();
    this.loggedMobIdentities.clear();
    this.positions.reset();
    this.loot.reset();
    this.toastedLootIds.clear();
    if (this.minimapTimer !== undefined) clearTimeout(this.minimapTimer);
    this.minimapTimer = undefined;
    this.publishMinimap(true);
    this.tower.reset();
    this.lastLoggedLocation = undefined;
    this.lastObservedMapId = undefined;
    this.clearTowerLocationTimer();
    this.towerLocationDeadlineMs = undefined;
    this.currentChannel = undefined;
    this.setServerInstance(undefined);
    this.reportedGravestones.clear();
    this.clearPacketBuffer();
    this.targetState = "waiting";
    this.receivedDataForCurrentGame = false;
    this.hasReceivedCaptureData = false;
    this.waitingForDataReported = false;
    this.activeConnectionId = undefined;
    this.lastAuthenticated = undefined;
    this.sawAuthenticated = false;
    this.sawAdmittedTrafficBeforeAuthentication = false;
    this.clearDiagnosticTransition();
    const session = this.session;
    this.session = undefined;
    this.combatLog = undefined;
    this.rewardsLog = undefined;
    this.otherLog = undefined;
    try {
      await session?.close();
    } catch (error) {
      console.error("[spiritvale-logging]", errorMessage(error));
    }
    this.setStatus("stopped", "Capture stopped");
  }

  /**
   * Rotates the shared capture session: combat and rewards both start writing to a fresh log
   * session together, while actor/mob identities, reward baselines, and connection state carry
   * over so attribution keeps working immediately after the boundary. Callers that overlap the
   * in-flight rotation coalesce into it; a failed rotation leaves the previous session untouched.
   *
   * The handoff buffer is drained only once the rotation has fully settled and this guard is
   * released, so a map change that arrived mid-rotation rotates again on replay rather than being
   * swallowed by the rotation it happened to overlap.
   */
  async resetSession(): Promise<void> {
    // The commit rotates only when it resolved a location. When it could not — a tower run cleared
    // before the replacement map is known — the manual reset still has to rotate, or the user's
    // Reset silently does nothing.
    if (this.towerLocationTimer !== undefined && await this.commitTowerLocationTransition(true)) return;
    return this.rotateSession();
  }

  private async rotateSession(seed?: SessionSeed): Promise<void> {
    if (this.resettingSession) return this.resettingSession;
    if (this.stopping) throw new Error("cannot reset the capture session while it is stopping");
    // Establish the boundary before the asynchronous session creation begins. New-connection
    // identity packets must be replayed into the replacement log, not written to the old one.
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
    if (this.diagnosticLogging) streams.push("other");
    const seedIdentities = seed?.identities ?? this.actors.snapshot();
    // A manual reset stays on the current connection, so its current location remains valid. An
    // authentication-triggered rotation passes an explicit seed and must wait for that incoming
    // connection's traversal packet instead.
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
      this.otherLog?.log("capture.lifecycle", { state: "stopped" });

      // Combat activations do not carry meaning across a session boundary; actor/mob identities
      // and the reward baseline are preserved above.
      this.combat.reset();
      this.loggedShortDisplayStatuses.clear();
      this.lastLoggedLocation = undefined;

      this.session = nextSession;
      this.combatLog = nextSession.logger("combat");
      this.rewardsLog = nextSession.logger("rewards");
      this.otherLog = this.diagnosticLogging ? nextSession.logger("other") : undefined;

      for (const identity of seedIdentities) {
        this.combatLog.log("combat.actorIdentity", jsonObject({ kind: "actorIdentity", operation: "upsert", tick: 0, ...identity }));
      }
      if (seedLocation !== undefined) this.logLocation(seedLocation, 0);
      this.publishActiveStatuses(true);

      this.combatLog.log("combat.lifecycle", { state: "started" });
      this.rewardsLog.log("rewards.lifecycle", { state: "started" });
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
      // `handoff` stays set until resetSession releases its guard, alongside the buffer drain.
      const handoffFailure = this.handoffFailure;
      this.handoffFailure = undefined;
      if (handoffFailure) {
        this.clearPacketBuffer();
        throw handoffFailure;
      }
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
    if (target.state === "waiting") {
      this.receivedDataForCurrentGame = false;
      if (!this.missingGameReported) {
        this.missingGameReported = true;
        this.reportError(
          "Game was not detected for capture",
          `${target.processName} was not found by Windows process inspection. The game may not be running, may still be starting, or process inspection may be blocked.`,
          { "Expected process": target.processName },
        );
      }
    } else {
      // A later transition back to waiting represents a new game exit/detection problem and
      // deserves one new entry. Repeated waiting updates remain suppressed.
      this.missingGameReported = false;
      if (this.hasReceivedCaptureData && !this.receivedDataForCurrentGame && !this.waitingForDataReported) {
        this.waitingForDataReported = true;
        this.reportError(
          "Game detected, but capture is waiting for data",
          `${target.processName} is running again, but capture has not received game network data since it was last detected. Changing channel or map may create a fresh connection; otherwise verify the selected network adapter or VPN routing.`,
          {
            "Expected process": target.processName,
            "Network adapter": this.options.deviceName ?? "Automatic selection",
          },
        );
      }
    }
    this.refreshCaptureDetail();
  }

  private captureWarning(message: string): void {
    this.combatLog?.log("combat.warning", { message });
    this.rewardsLog?.log("rewards.warning", { message });
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
    if (this.towerLocationTimer !== undefined) {
      if (packet.connectionId === this.activeConnectionId && isTowerStatePacket(packet)) {
        if (this.tower.consume(packet)) {
          this.pendingTowerLocationTick = packet.tick;
          this.scheduleTowerLocationCommit();
        }
        return;
      }
      if (packet.connectionId === this.activeConnectionId) this.observePhysicalMap(packet);
      this.logPacketAdmission(packet, "buffered", "tower-location-settle", this.activeConnectionId);
      this.bufferHandoffPacket(packet);
      return;
    }
    if (this.handoff) {
      this.logPacketAdmission(packet, "buffered", "capture-session-handoff", this.activeConnectionId);
      this.bufferHandoffPacket(packet);
      return;
    }
    if (packet.packetName === "authenticated") this.beginTransitionDiagnostic(packet);
    if (isStatusPacket(packet)) {
      this.otherLog?.log("capture.statusPacket", jsonObject({ phase: "input", ...fishNetPacketDiagnostic(packet) }));
    }
    if (!this.receivedDataForCurrentGame) {
      this.receivedDataForCurrentGame = true;
      this.hasReceivedCaptureData = true;
      this.waitingForDataReported = false;
      this.refreshCaptureDetail();
    }
    // Character-save callbacks are connection-independent; object-bound character data is routed
    // only after the same active-connection admission used by every other capture domain.
    // Inspect replies are a separate stream: the same CharacterData for a DIFFERENT player. Routed
    // before admission for the same reason character callbacks are — the reply can arrive on a
    // connection the active-connection gate would reject, and it belongs to no unit object.
    const inspectHandled = this.inspected.consume(packet);
    let characterHandled = this.character.consumeBeforeAdmission(packet);
    if (!this.admitPacket(packet)) return;
    if (!this.sawAuthenticated
      && packet.packetName !== "authenticated"
      && packet.packetName !== "disconnect") {
      this.sawAdmittedTrafficBeforeAuthentication = true;
    }
    this.trackChannel(packet);
    const admittedCharacterHandled = this.character.consumeAdmitted(packet);
    characterHandled ||= admittedCharacterHandled || inspectHandled;
    // The tracker only self-resets when the authentication arrives on the connection it was last
    // updated from, which a channel or map change never does — it authenticates on a NEW connection.
    // Without an explicit reset the stale floor outlives the run and every zone on the new connection
    // would be logged as that floor.
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
        return;
      }
    }
    this.countUnresolvedPacket(packet);
    if (packet.splitDropReason !== undefined) {
      this.combatLog?.log("combat.warning", {
        message: `split reassembly dropped (${packet.splitDropReason}) at tick ${packet.tick}`,
      });
    }
    const loggedZone = this.logZone(packet);
    // Actor IDs and zones belong to the incoming connection. The replacement log receives both
    // from its buffered packets after the handoff completes, rather than inheriting stale state.
    const transitionSeed = packet.packetName === "authenticated" ? {} : undefined;
    let handled = characterHandled || loggedZone || towerChanged;
    let combatEvents: FishNetCombatEvent[] = [];
    try {
      this.mobs.consume(packet);
      handled = this.consumeGravestone(packet) || handled;
      if (packet.packetName === "authenticated" || packet.packetName === "disconnect") {
        this.loggedMobIdentities.clear();
      }
      const identities = this.actors.consume(packet);
      if (this.minimapEnabled() && this.positions.consume(packet).length > 0) this.scheduleMinimapPublish();
      const events = this.combat.consume(packet);
      combatEvents = events;
      if (isStatusPacket(packet)) {
        this.otherLog?.log("capture.statusPacket", jsonObject({
          phase: "output",
          tick: packet.tick,
          connectionId: packet.connectionId,
          rpcName: packet.rpcName,
          statusEvents: events.filter((event) => event.kind === "status"),
        }));
      }
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
      const observedAtMs = Date.now();
      for (const identity of identities) this.statusTracker.consumeIdentity(identity);
      for (const event of events) this.statusTracker.consume(event, observedAtMs);
      this.scheduleActiveStatusExpiry();
      for (const event of events) {
        if (event.kind !== "summon" || !event.recovered) continue;
        // Recovery only fires when the capture could not name the packet at all, which means this
        // connection is losing summon traffic wholesale. Keep the rate visible rather than letting a
        // heuristic quietly paper over it.
        this.combatLog?.log("combat.warning", {
          message: `recovered an unnamed summon calibration (${event.skillId} ×${event.stacks}) at tick ${event.tick}`,
        });
      }
      handled ||= identities.length > 0 || events.length > 0;
      for (const event of identities) this.combatLog?.log("combat.actorIdentity", jsonObject(event));
      for (const event of events) if (event.actorId !== undefined) this.logMobIdentity(event.actorId, event.tick);
      for (const event of events) if (this.shouldLogCombatEvent(event)) this.combatLog?.log("combat.event", jsonObject(event));
      this.publishActiveStatuses();
      // Spawn diagnostics contain raw protocol payloads and are intentionally not written to combat logs.
    } catch (error) {
      handled = true;
      this.logDomainWarning("combat", error);
    }

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
      handled ||= events.length > 0;
      for (const event of events) {
        this.rewardsLog?.log(event.kind === "kill" ? "rewards.kill" : "rewards.unmatched", jsonObject(event));
      }
    } catch (error) {
      handled = true;
      this.logDomainWarning("rewards", error);
    }

    if (!handled && this.diagnosticLogging) this.otherLog?.log("fishnet.packet", unclassifiedPacket(packet));
    if (transitionSeed) this.resetOnMapChange(transitionSeed);
  }

  /**
   * Rotates the session, and/or resets the all-time gold tracker, on a map or channel change, when
   * the respective setting asks for it. The game sends no dedicated packet for either: both
   * re-authenticate, which is also what makes the actor directory clear itself. Only admitted packets
   * reach here, so a stale connection's trailing authentication and a duplicate of the same
   * authentication cannot rotate or reset anything.
   *
   * A first authentication with no earlier admitted traffic is the login itself rather than a
   * transition, and is skipped so opening the app never rotates an empty session. When capture
   * attaches to a game already in progress, ordinary traffic arrives without that historical login;
   * its first observed authentication is therefore a real map/channel change and must rotate.
   */
  private resetOnMapChange(seed: SessionSeed): void {
    const initialLogin = !this.sawAuthenticated && !this.sawAdmittedTrafficBeforeAuthentication;
    this.sawAuthenticated = true;
    if (initialLogin) return;
    this.options.onGoldMapChange?.();
    if (!this.options.resetOnMapChange?.()) return;
    // Failures are already surfaced through onError by resetSession itself, and leave the current
    // session intact — there is nothing further to do with the rejection here.
    void this.rotateSession(seed).catch(() => {});
  }

  /**
   * Counts packets the decoder could not attribute, and reports a per-window summary.
   *
   * Both counters are silent killers: an rpcLink whose registration was never seen carries no object
   * id or method name, and an `ambiguous` packet carries no method name, so either way the packet is
   * simply dropped by every domain tracker. A session where clone tracking or damage attribution
   * "just stops working" looks identical in the combat log to one where the game sent nothing —
   * these counts are what tell the two apart.
   */
  private countUnresolvedPacket(packet: CapturedFishNetPacket): void {
    if (packet.packetName === "rpcLink" && packet.linkResolved === false) {
      this.unresolvedCounts.set("rpcLink:unregistered", (this.unresolvedCounts.get("rpcLink:unregistered") ?? 0) + 1);
    } else if (packet.rpcResolution === "recovered") {
      // Not a loss — a quarantined registration that survived corroboration. Counted so the
      // promotion rate stays visible next to the losses it is offsetting.
      this.unresolvedCounts.set("rpcLink:recovered", (this.unresolvedCounts.get("rpcLink:recovered") ?? 0) + 1);
    } else if (packet.rpcResolution === "ambiguous") {
      const key = `ambiguous:${packet.packetName}:hash=${packet.rpcHash}:component=${packet.networkBehaviourIndex}`;
      this.unresolvedCounts.set(key, (this.unresolvedCounts.get(key) ?? 0) + 1);
    } else {
      return;
    }
    const now = Date.now();
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
    if (actorId === this.character.physicalObjectId()) return true;
    const characterName = this.character.current()?.name;
    if (characterName === undefined) return false;
    const attributed = this.actors.getAttribution(actorId)?.displayName;
    // The CharacterData name and the spawn/VisualData name are separate wire sources, so they
    // must be compared through the shared identity key rather than raw equality.
    return attributed !== undefined && normalizeName(attributed) === normalizeName(characterName);
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
   * Learns the local player's channel and server instance, for stamping onto boss kills.
   *
   * `ChannelList_T` is the only source. It is sent to this client alone, names the current channel
   * outright, and carries the instance id (`na3-12`) the region is derived from. It also arrives on
   * its own: the game sends one within a few seconds of every authentication, so no menu needs to
   * be opened, and a channel switch re-authenticates and therefore produces a fresh one.
   *
   * `SyncInstanceState` looked like a continuous second source and is not: a full session's capture
   * contained not one of them, so relying on it only made the channel look better covered than it
   * was. Both readings are cleared on (re)authentication, leaving a few seconds where a kill is
   * recorded with no channel rather than the previous connection's.
   *
   * `currentIndex` is zero-based, converted once here so every consumer downstream sees the channel
   * number the game itself displays.
   */
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

  /** Records the server instance, announcing it only when the reading actually moved. */
  private setServerInstance(instanceId: string | undefined): void {
    if (instanceId === this.currentInstanceId) return;
    this.currentInstanceId = instanceId;
    this.options.onServerInstance?.(instanceId);
  }

  /**
   * Map traversal and instance-state RPCs carry the numeric map ID but produce no combat event.
   * Store it as an inert activation so the existing combat log follower transports it without
   * changing the upstream log protocol or creating a damage encounter.
   */
  private logZone(packet: CapturedFishNetPacket): boolean {
    const mapId = this.observePhysicalMap(packet);
    if (mapId === undefined) return false;
    const location = this.effectiveLocation();
    if (location === undefined || sameSpiritValeLocation(this.lastLoggedLocation, location)) return true;
    this.logLocation(location, packet.tick);
    return true;
  }

  private observePhysicalMap(packet: CapturedFishNetPacket): number | undefined {
    if (packet.rpcName === undefined || !MAP_RPC_NAMES.has(packet.rpcName)) return undefined;
    const mapId = packet.decodedFields?.find((field) => field.name === "mapId")?.value;
    if (typeof mapId !== "number" || !Number.isSafeInteger(mapId) || mapId < 0) return undefined;
    this.lastObservedMapId = mapId;
    return mapId;
  }

  private effectiveLocation(): SpiritValeLocation | undefined {
    const tower = this.tower.current();
    if (tower.inTower && tower.floor !== undefined) return { kind: "eternalTower", floor: tower.floor };
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
        : `${TOWER_FLOOR_EVENT_SOURCE_PREFIX}${location.floor}`,
      sourceLabel: location.kind === "map"
        ? `Zone ${location.mapId}`
        : `Eternal Tower - Floor ${location.floor}`,
    });
  }

  /**
   * Debounces the commit so an exit-entry-floor burst produces one transition, but never past the
   * deadline set by the first pending change: every non-tower packet is buffered while the timer is
   * armed, so a stream of tower updates closer together than the settle window would otherwise grow
   * the handoff buffer until it trips its bound and stops the capture outright.
   */
  private scheduleTowerLocationCommit(): void {
    this.towerLocationDeadlineMs ??= Date.now() + TOWER_LOCATION_MAX_SETTLE_MS;
    const delay = Math.max(0, Math.min(TOWER_LOCATION_SETTLE_MS, this.towerLocationDeadlineMs - Date.now()));
    this.clearTowerLocationTimer();
    this.towerLocationTimer = setTimeout(() => {
      void this.commitTowerLocationTransition().catch((error) => {
        this.reportError("Tower location could not be committed", errorMessage(error));
      });
    }, delay);
    this.towerLocationTimer.unref?.();
  }

  private clearTowerLocationTimer(): void {
    if (this.towerLocationTimer !== undefined) clearTimeout(this.towerLocationTimer);
    this.towerLocationTimer = undefined;
  }

  /**
   * Closes the settle window, and reports whether it rotated the session.
   *
   * `allowSideEffects` is false only for the flush performed while stopping: the transition is still
   * logged, but neither the session rotation nor the all-time gold reset may fire, because from the
   * user's side nothing changed — the app is shutting down.
   */
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

  private activeStatuses(nowMs = Date.now()): FishNetActiveStatus[] {
    this.statusTracker.advance(nowMs);
    const actorId = this.character.physicalObjectId();
    return actorId === undefined ? [] : this.statusTracker.getActiveStatuses(actorId, nowMs);
  }

  /** Publishes only when the status reducer or local-player actor changed. */
  private publishActiveStatuses(force = false): void {
    const nowMs = Date.now();
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
    if (this.activeStatusTimer !== undefined) clearTimeout(this.activeStatusTimer);
    this.activeStatusTimer = undefined;
    const expiresAtMs = this.statusTracker.nextExpiryAtMs();
    if (expiresAtMs === undefined) return;
    this.activeStatusTimer = setTimeout(() => {
      this.activeStatusTimer = undefined;
      this.publishActiveStatuses();
    }, Math.max(0, expiresAtMs - Date.now()));
    this.activeStatusTimer.unref?.();
  }

  private minimapState(): CaptureMinimapState {
    return { self: this.positions.self(), loot: this.loot.active() };
  }

  private minimapEnabled(): boolean {
    return this.options.minimapEnabled?.() ?? true;
  }

  /**
   * A drop's name and rarity usually arrive inside its own spawn packet, but are not guaranteed to
   * — the game can send them as a follow-up `update` once the item is named. Both kinds are
   * considered here, and `toastedLootIds` keeps a drop from raising a second toast once the later
   * update arrives.
   */
  private emitLootToasts(events: readonly FishNetLootDropEvent[]): void {
    if (this.lootToastListeners.size === 0) return;
    const threshold = this.options.getMinimapRarityFilter?.() ?? 0;
    for (const event of events) {
      if (event.kind === "removed" || this.toastedLootIds.has(event.drop.objectId)) continue;
      if (event.drop.displayName === undefined || (event.drop.rarity ?? 0) < threshold) continue;
      this.toastedLootIds.add(event.drop.objectId);
      const toast: CaptureLootToastEvent = {
        objectId: event.drop.objectId,
        displayName: event.drop.displayName,
        ...(event.drop.rarity === undefined ? {} : { rarity: event.drop.rarity }),
        ...(event.drop.spriteId === undefined ? {} : { spriteId: event.drop.spriteId }),
      };
      for (const listener of this.lootToastListeners) listener(toast);
    }
  }

  private scheduleMinimapPublish(): void {
    if (this.minimapTimer !== undefined) return;
    this.minimapTimer = setTimeout(() => {
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

  /**
   * Routes only the active game-server connection. Map changes open a new connection whose
   * trailing authenticated/disconnect packets from the old one must not wipe fresh actor state.
   */
  private admitPacket(packet: CapturedFishNetPacket): boolean {
    const connectionId = packet.connectionId;
    const activeBefore = this.activeConnectionId;
    this.activeConnectionId ??= connectionId;
    if (connectionId !== this.activeConnectionId) {
      if (packet.packetName !== "authenticated") {
        this.logPacketAdmission(packet, "rejected", "inactive-connection", activeBefore);
        return false;
      }
      this.activeConnectionId = connectionId;
    }
    if (packet.packetName === "authenticated") {
      if (this.lastAuthenticated?.connectionId === connectionId && this.lastAuthenticated.tick === packet.tick) {
        this.logPacketAdmission(packet, "rejected", "duplicate-authenticated", activeBefore);
        return false;
      }
      this.lastAuthenticated = { connectionId, tick: packet.tick };
    }
    if (packet.packetName === "disconnect") this.activeConnectionId = undefined;
    if (packet.packetName === "authenticated" || packet.packetName === "disconnect" || isStatusPacket(packet)) {
      this.logPacketAdmission(packet, "accepted", undefined, activeBefore);
    }
    return true;
  }

  private logPacketAdmission(
    packet: CapturedFishNetPacket,
    decision: "accepted" | "rejected" | "buffered",
    reason: string | undefined,
    activeConnectionId: string | undefined,
  ): void {
    if (!this.diagnosticLogging) return;
    this.otherLog?.log("capture.packetAdmission", jsonObject({
      decision,
      reason,
      activeConnectionId,
      packetConnectionId: packet.connectionId,
      tick: packet.tick,
      packetName: packet.packetName,
      rpcName: packet.rpcName,
      objectId: packet.objectId,
      rpcResolution: packet.rpcResolution,
    }));
  }

  /**
   * Retains a small amount of LiteNet traffic so an authenticated packet can flush the wire-level
   * lead-in to a map transition, then records a bounded post-authentication window. This sits below
   * FishNet decoding and connection admission, which lets a diagnostic session distinguish a server
   * omission from a decoder or routing loss without making raw traffic logging permanently unbounded.
   */
  private captureLiteNetDiagnostic(packet: CapturedLiteNetLibPacket): void {
    const capturedAtMs = packet.udpPacket.capturedAt.getTime();
    const bytes = packet.packet.raw.length;
    const data = liteNetPacketDiagnostic(packet);
    if (capturedAtMs <= this.diagnosticTransitionUntilMs) {
      if (this.diagnosticTransitionBytes + bytes <= DIAGNOSTIC_TRANSITION_BYTE_LIMIT) {
        this.diagnosticTransitionBytes += bytes;
        this.otherLog?.log("capture.liteNetPacket", jsonObject({
          transitionId: this.diagnosticTransitionId,
          phase: "after-authenticated",
          ...data,
        }));
      } else if (!this.diagnosticTransitionTruncated) {
        this.diagnosticTransitionTruncated = true;
        this.otherLog?.log("capture.diagnosticLimit", {
          transitionId: this.diagnosticTransitionId,
          phase: "after-authenticated",
          byteLimit: DIAGNOSTIC_TRANSITION_BYTE_LIMIT,
        });
      }
      return;
    }

    this.diagnosticLiteNetBuffer.push({ capturedAtMs, bytes, data });
    this.diagnosticLiteNetBufferBytes += bytes;
    const oldestAllowed = capturedAtMs - DIAGNOSTIC_PRE_AUTH_MS;
    while (this.diagnosticLiteNetBuffer[0]
      && (this.diagnosticLiteNetBuffer[0].capturedAtMs < oldestAllowed
        || this.diagnosticLiteNetBufferBytes > DIAGNOSTIC_PRE_AUTH_BYTE_LIMIT)) {
      const dropped = this.diagnosticLiteNetBuffer.shift()!;
      this.diagnosticLiteNetBufferBytes -= dropped.bytes;
      this.diagnosticLiteNetDropped += 1;
    }
  }

  private beginTransitionDiagnostic(packet: CapturedFishNetPacket): void {
    if (!this.diagnosticLogging) return;
    const capturedAtMs = packet.liteNetPacket?.udpPacket.capturedAt.getTime() ?? Date.now();
    this.diagnosticTransitionId += 1;
    this.diagnosticTransitionUntilMs = capturedAtMs + DIAGNOSTIC_POST_AUTH_MS;
    this.diagnosticTransitionBytes = 0;
    this.diagnosticTransitionTruncated = false;
    this.otherLog?.log("capture.mapTransition", {
      transitionId: this.diagnosticTransitionId,
      tick: packet.tick,
      connectionId: packet.connectionId,
      bufferedLiteNetPackets: this.diagnosticLiteNetBuffer.length,
      bufferedLiteNetBytes: this.diagnosticLiteNetBufferBytes,
      droppedBufferedPackets: this.diagnosticLiteNetDropped,
      preAuthenticatedMs: DIAGNOSTIC_PRE_AUTH_MS,
      postAuthenticatedMs: DIAGNOSTIC_POST_AUTH_MS,
    });
    for (const entry of this.diagnosticLiteNetBuffer) {
      this.diagnosticTransitionBytes += entry.bytes;
      this.otherLog?.log("capture.liteNetPacket", jsonObject({
        transitionId: this.diagnosticTransitionId,
        phase: "before-authenticated",
        ...entry.data,
      }));
    }
    this.diagnosticLiteNetBuffer = [];
    this.diagnosticLiteNetBufferBytes = 0;
    this.diagnosticLiteNetDropped = 0;
  }

  private clearDiagnosticTransition(): void {
    this.diagnosticLiteNetBuffer = [];
    this.diagnosticLiteNetBufferBytes = 0;
    this.diagnosticLiteNetDropped = 0;
    this.diagnosticTransitionUntilMs = 0;
    this.diagnosticTransitionBytes = 0;
    this.diagnosticTransitionTruncated = false;
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

function isStatusPacket(packet: CapturedFishNetPacket): boolean {
  return packet.rpcName !== undefined && STATUS_RPC_NAMES.has(packet.rpcName);
}

function isTowerStatePacket(packet: CapturedFishNetPacket): boolean {
  return packet.rpcName === "ETUpdateRun" || packet.rpcName === "ETAdvanceFloor";
}

/** A zero-based channel index field as the one-based channel number the game displays. */
function channelFromIndex(packet: CapturedFishNetPacket, fieldName: string): number | undefined {
  const index = packet.decodedFields?.find((field) => field.name === fieldName)?.value;
  if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) return undefined;
  return index + 1;
}

function fishNetPacketDiagnostic(packet: CapturedFishNetPacket): JsonObject {
  return jsonObject({
    tick: packet.tick,
    connectionId: packet.connectionId,
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

function unclassifiedPacket(packet: CapturedFishNetPacket): JsonObject {
  return fishNetPacketDiagnostic(packet);
}

function liteNetPacketDiagnostic(packet: CapturedLiteNetLibPacket): JsonObject {
  const udp = packet.udpPacket;
  const liteNet = packet.packet;
  return jsonObject({
    capturedAt: udp.capturedAt,
    direction: udp.direction,
    sourceIP: udp.sourceIP,
    sourcePort: udp.sourcePort,
    destinationIP: udp.destinationIP,
    destinationPort: udp.destinationPort,
    interfaceIndex: udp.interfaceIndex,
    truncated: udp.truncated,
    property: liteNet.property,
    connectionNumber: liteNet.connectionNumber,
    sequence: "sequence" in liteNet ? liteNet.sequence : undefined,
    channel: "channel" in liteNet ? liteNet.channel : undefined,
    fragment: "fragment" in liteNet ? liteNet.fragment : undefined,
    mergePath: packet.mergePath,
    rawHex: liteNet.raw,
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
