import { readFile } from "node:fs/promises";

import { loadBundledMobRewardCatalog, queryMobRewardCatalog } from "@kar-mi/spirit-vale-tools-rewards";
import { SafeSaveQueue } from "@svoverlay/desktop-platform/safe-save";
import { writeJsonFileAtomic } from "@svoverlay/desktop-platform/json-settings";
import {
  bossRegionOf,
  bossTimerKey,
  bossTimerRemoveAtMs,
  isBossChannel,
  type BossCatalogOption,
  type BossTimer,
  type BossTimerState,
} from "@svoverlay/contracts/boss-timers";

/**
 * A boss's gravestone seen on the wire, stamped with where capture believed the player was.
 *
 * `diedAtMs` is the server's own time of death carried by the marker, not the moment it came into
 * view, so a marker found long after the fact still dates the kill correctly.
 */
export interface BossGravestoneObservation {
  mobId: string;
  bossName: string;
  channel?: number;
  /** Raw server instance id, e.g. `na3-12`; the region is derived from it. */
  instanceId?: string;
  /** Player the marker credits with the kill. */
  killedBy?: string;
  diedAtMs: number;
}

/** A gravestone the player logged by hand: which boss, where, and when it died. */
export interface ManualBossTimerEntry {
  mobId: string;
  channel: number;
  /** Region to file it under, normally the one the player is currently in. */
  region?: string;
  diedAtMs: number;
}

export interface BossTimerCoordinatorOptions {
  storagePath: string;
  onWarning?: (warning: string | undefined) => void;
  /** Test injection point; the coordinator otherwise runs on the wall clock. */
  now?: () => number;
}

interface PersistedBossTimers {
  cacheVersion: 1;
  timers: BossTimer[];
}

/**
 * Owns the app-wide boss respawn timers: gravestones seen on the wire and ones logged by hand both
 * land here, the overlay and the Settings window read the same state, and the timers survive an app
 * restart. Runs independently of any window being open, so a marker seen while the overlay is
 * closed still starts its clock.
 *
 * One timer exists per boss per channel per region. Recording a death for a combination that
 * already has a timer re-anchors it to the new time of death — which is exactly the "reset to 60
 * minutes minus the time already elapsed" rule manual entries call for.
 */
export interface BossTimerCoordinator {
  getState(): BossTimerState;
  /** Bosses pickable in the manual entry form, from the bundled catalog, in level order. */
  bossOptions(): BossCatalogOption[];
  /** Raw server instance the player is currently on, e.g. `na3-12`, as capture last reported it. */
  currentInstanceId(): string | undefined;
  /**
   * Records where the player is now, which is the default region for a manual entry and the region
   * whose tab the overlay opens on. Notifies subscribers when it changes so both follow along.
   */
  setCurrentInstance(instanceId: string | undefined): void;
  /**
   * Records which character is being played, so a marker crediting them can be shown as their own
   * kill. Notifies subscribers when it changes, since every timer's marker depends on it.
   */
  setPlayerName(playerName: string | undefined): void;
  recordGravestone(gravestone: BossGravestoneObservation): void;
  /** Returns the recorded timer, or undefined when the entry named an unknown boss. */
  addManualTimer(entry: ManualBossTimerEntry): BossTimer | undefined;
  removeTimer(id: string): void;
  subscribe(listener: () => void): () => void;
  shutdown(): Promise<void>;
}

export async function createBossTimerCoordinator(
  options: BossTimerCoordinatorOptions,
): Promise<BossTimerCoordinator> {
  const now = options.now ?? Date.now;
  /** Keyed by {@link bossTimerKey}; insertion order is not meaningful, `getState` sorts. */
  const timers = new Map<string, BossTimer>();
  const listeners = new Set<() => void>();
  const catalogBosses = queryMobRewardCatalog(loadBundledMobRewardCatalog(), { boss: true });
  const pickableBosses: BossCatalogOption[] = catalogBosses
    .map((boss) => ({ mobId: boss.id, displayName: boss.displayName, level: boss.level }))
    .sort((left, right) => left.level - right.level || left.displayName.localeCompare(right.displayName));
  const bossNames = new Map(pickableBosses.map((boss) => [boss.mobId, boss.displayName]));
  let shuttingDown = false;
  /** Where the player is now, as capture last reported it; see {@link BossTimerCoordinator.setCurrentInstance}. */
  let currentInstanceId: string | undefined;
  /** Who the player is now; see {@link BossTimerCoordinator.setPlayerName}. */
  let playerName: string | undefined;
  /** Arms the next automatic removal; absent while no timer is heading for one. */
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;

  const persistence = new SafeSaveQueue<BossTimer[]>({
    label: "boss timers",
    // `snapshotTimers` builds a fresh array per schedule that nothing mutates afterwards.
    clone: false,
    save: (value) => saveBossTimers(value, options.storagePath),
    onWarning: (warning) => options.onWarning?.(warning),
  });

  for (const timer of await loadBossTimers(options.storagePath)) {
    // Two stored timers can normalize onto one key — a file written before the second server
    // families were folded into their region holds `sun` and `na` separately, and both land on
    // `na` now. File order says nothing about which death was more recent, so the newer one wins
    // explicitly rather than whichever happened to be written last.
    const existing = timers.get(timer.id);
    if (existing !== undefined && existing.diedAtMs >= timer.diedAtMs) continue;
    timers.set(timer.id, timer);
  }
  prune();
  scheduleCleanup();

  return {
    getState,
    bossOptions: () => pickableBosses.map((boss) => ({ ...boss })),
    currentInstanceId: () => currentInstanceId,
    setCurrentInstance,
    setPlayerName,
    recordGravestone,
    addManualTimer,
    removeTimer,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    shutdown: async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
      cleanupTimer = undefined;
      await persistence.flush(snapshotTimers());
    },
  };

  function getState(): BossTimerState {
    // Soonest boundary first, so every consumer lists the most imminent timer on top.
    const sorted = [...timers.values()].sort((left, right) => left.diedAtMs - right.diedAtMs);
    const currentRegion = bossRegionOf(currentInstanceId);
    return {
      timers: sorted.map((timer) => ({ ...timer })),
      ...(currentRegion === undefined ? {} : { currentRegion }),
      ...(playerName === undefined ? {} : { playerName }),
    };
  }

  function setCurrentInstance(instanceId: string | undefined): void {
    if (shuttingDown || instanceId === currentInstanceId) return;
    currentInstanceId = instanceId;
    // Deliberately not `changed()`: nothing about the timers themselves moved, so there is nothing
    // to persist or prune. Consumers still need telling, because which region tab is showing and
    // which region a manual entry defaults to both follow this.
    for (const listener of listeners) listener();
  }

  function setPlayerName(next: string | undefined): void {
    const trimmed = next?.trim();
    const resolved = trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
    if (shuttingDown || resolved === playerName) return;
    playerName = resolved;
    // Same reasoning as `setCurrentInstance`: no timer moved, so nothing to persist or prune, but
    // which timers are marked as the player's own follows this.
    for (const listener of listeners) listener();
  }

  function recordGravestone(gravestone: BossGravestoneObservation): void {
    if (shuttingDown) return;
    if (!gravestone.mobId || !gravestone.bossName || !Number.isFinite(gravestone.diedAtMs)) return;
    // A boss that died on a channel outside the world-boss rotation was summoned by a player and
    // respawns nothing. Note this rejects the sighting outright rather than falling back to an
    // unknown channel: an observed channel of 7 is positive evidence that no timer belongs here,
    // which is not the same as never having seen one.
    if (gravestone.channel !== undefined && !isBossChannel(gravestone.channel)) return;
    const region = bossRegionOf(gravestone.instanceId);
    const diedAtMs = Math.min(gravestone.diedAtMs, now());
    // An observation that could not say where it happened carries strictly less than one that
    // could, so it must not stand a second, placeless timer beside the answer we already have.
    // Reconnecting is what makes this reachable: nearby objects respawn into view before the
    // channel list lands, so a marker already filed correctly is seen again with nothing to place
    // it by. Same boss and same server-stamped time of death means the same death, not a new one.
    if (region === undefined && gravestone.channel === undefined
      && isDeathAlreadyPlaced(gravestone.mobId, diedAtMs)) return;
    // Every marker re-anchors, however soon it follows the last one. A second death well inside the
    // respawn hour looks impossible but is not: players can spawn a boss from a summoning item on
    // these same channels, and killing that one overwrites the natural timer — the boss then
    // respawns 60-90 minutes from the summoned kill. Refusing an early repeat would leave a stale
    // timer firing before the boss is really due, which is the worse of the two errors.
    upsert({
      mobId: gravestone.mobId,
      bossName: gravestone.bossName,
      ...(region === undefined ? {} : { region }),
      ...(gravestone.instanceId === undefined ? {} : { instanceId: gravestone.instanceId }),
      ...(gravestone.channel === undefined ? {} : { channel: gravestone.channel }),
      ...(gravestone.killedBy === undefined ? {} : { killedBy: gravestone.killedBy }),
      diedAtMs,
      source: "gravestone",
    });
  }

  /** Whether a timer already records this exact death somewhere it was able to place. */
  function isDeathAlreadyPlaced(mobId: string, diedAtMs: number): boolean {
    for (const timer of timers.values()) {
      if (timer.mobId !== mobId || timer.diedAtMs !== diedAtMs) continue;
      if (timer.region !== undefined || timer.channel !== undefined) return true;
    }
    return false;
  }

  function addManualTimer(entry: ManualBossTimerEntry): BossTimer | undefined {
    if (shuttingDown) return undefined;
    const bossName = bossNames.get(entry.mobId);
    if (bossName === undefined || !isBossChannel(entry.channel) || !Number.isFinite(entry.diedAtMs)) {
      return undefined;
    }
    // A death cannot have happened in the future; a mistyped time clamps to "just now".
    const region = bossRegionOf(entry.region);
    return upsert({
      mobId: entry.mobId,
      bossName,
      ...(region === undefined ? {} : { region }),
      channel: entry.channel,
      diedAtMs: Math.min(entry.diedAtMs, now()),
      source: "manual",
    });
  }

  function removeTimer(id: string): void {
    // Same guard the other two mutators carry: past shutdown the final flush has already run, so a
    // removal landing here would schedule a write nothing is left to complete.
    if (shuttingDown) return;
    if (!timers.delete(id)) return;
    changed();
  }

  function upsert(timer: Omit<BossTimer, "id">): BossTimer {
    const next: BossTimer = { id: bossTimerKey(timer.mobId, timer.region, timer.channel), ...timer };
    supersedeUnlocated(next);
    timers.set(next.id, next);
    changed();
    return next;
  }

  /**
   * Drops the placeholder a located observation is the corrected form of.
   *
   * A gravestone noticed in the seconds before the channel list arrives carries neither channel nor
   * region and lands in the "unknown" bucket. Seeing the same marker again once capture knows where
   * we are files it properly, and the two are the same death — identical boss, identical
   * server-stamped time — so the placeholder is retired rather than left beside its own correction.
   */
  function supersedeUnlocated(next: BossTimer): void {
    if (next.region === undefined && next.channel === undefined) return;
    const unlocatedId = bossTimerKey(next.mobId, undefined, undefined);
    if (unlocatedId === next.id) return;
    const unlocated = timers.get(unlocatedId);
    if (unlocated?.diedAtMs === next.diedAtMs) timers.delete(unlocatedId);
  }

  function changed(): void {
    prune();
    persistence.schedule(snapshotTimers());
    for (const listener of listeners) listener();
    scheduleCleanup();
  }

  /** Drops timers whose expiry alert has been showing long enough; see the contract's linger. */
  function prune(): boolean {
    const nowMs = now();
    let removed = false;
    for (const [id, timer] of timers) {
      if (nowMs < bossTimerRemoveAtMs(timer)) continue;
      timers.delete(id);
      removed = true;
    }
    return removed;
  }

  /**
   * Timers otherwise change only when a death is recorded, so their eventual removal is the one
   * transition that needs a clock: one wake-up at the earliest removal, rearmed after every change.
   */
  function scheduleCleanup(): void {
    if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
    cleanupTimer = undefined;
    if (shuttingDown || timers.size === 0) return;
    const nextRemoveAtMs = Math.min(...[...timers.values()].map(bossTimerRemoveAtMs));
    cleanupTimer = setTimeout(() => {
      cleanupTimer = undefined;
      if (!prune()) {
        scheduleCleanup();
        return;
      }
      persistence.schedule(snapshotTimers());
      for (const listener of listeners) listener();
      scheduleCleanup();
    }, Math.max(0, nextRemoveAtMs - now()));
    // A pending removal is never a reason to keep the process alive.
    cleanupTimer.unref?.();
  }

  function snapshotTimers(): BossTimer[] {
    return [...timers.values()].map((timer) => ({ ...timer }));
  }
}

async function loadBossTimers(file: string): Promise<BossTimer[]> {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (!isPersistedBossTimers(value)) return [];
    return value.timers.flatMap((candidate) => {
      const timer = normalizeTimer(candidate);
      return timer ? [timer] : [];
    });
  } catch {
    return [];
  }
}

async function saveBossTimers(timers: BossTimer[], file: string): Promise<void> {
  const safe: PersistedBossTimers = { cacheVersion: 1, timers };
  await writeJsonFileAtomic(file, safe);
}

function normalizeTimer(value: unknown): BossTimer | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<BossTimer>;
  if (typeof candidate.mobId !== "string" || candidate.mobId.length === 0) return undefined;
  if (typeof candidate.bossName !== "string" || candidate.bossName.length === 0) return undefined;
  if (!Number.isFinite(candidate.diedAtMs)) return undefined;
  if (candidate.source !== "manual" && candidate.source !== "gravestone") {
    return undefined;
  }
  // Enforced on the way in as well as at every entry point, so a timer written before the
  // world-boss channel rule existed is dropped on upgrade rather than living on forever.
  if (candidate.channel !== undefined && !isBossChannel(candidate.channel)) return undefined;
  // Re-derived rather than trusted, so a file written before regions existed, or by a build that
  // stored the whole instance id, lands under the same region the live path would choose.
  const region = bossRegionOf(typeof candidate.region === "string" ? candidate.region : candidate.instanceId);
  const instanceId = typeof candidate.instanceId === "string" && candidate.instanceId.length > 0
    ? candidate.instanceId
    : undefined;
  return {
    id: bossTimerKey(candidate.mobId, region, candidate.channel),
    mobId: candidate.mobId,
    bossName: candidate.bossName,
    ...(region === undefined ? {} : { region }),
    ...(instanceId === undefined ? {} : { instanceId }),
    ...(candidate.channel === undefined ? {} : { channel: candidate.channel }),
    ...(typeof candidate.killedBy === "string" && candidate.killedBy.length > 0
      ? { killedBy: candidate.killedBy }
      : {}),
    diedAtMs: candidate.diedAtMs!,
    source: candidate.source,
  };
}

function isPersistedBossTimers(value: unknown): value is PersistedBossTimers {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedBossTimers>;
  return candidate.cacheVersion === 1 && Array.isArray(candidate.timers);
}
