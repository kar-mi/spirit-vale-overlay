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

export interface BossGravestoneObservation {
  mobId: string;
  bossName: string;
  channel?: number;
  instanceId?: string;
  killedBy?: string;
  diedAtMs: number;
}

export interface ManualBossTimerEntry {
  mobId: string;
  channel: number;
  region?: string;
  diedAtMs: number;
}

export interface BossTimerCoordinatorOptions {
  storagePath: string;
  onWarning?: (warning: string | undefined) => void;
  now?: () => number;
}

interface PersistedBossTimers {
  cacheVersion: 1;
  timers: BossTimer[];
}

export interface BossTimerCoordinator {
  getState(): BossTimerState;
  bossOptions(): BossCatalogOption[];
  currentInstanceId(): string | undefined;
  setCurrentInstance(instanceId: string | undefined): void;
  setPlayerName(playerName: string | undefined): void;
  recordGravestone(gravestone: BossGravestoneObservation): void;
  addManualTimer(entry: ManualBossTimerEntry): BossTimer | undefined;
  removeTimer(id: string): void;
  subscribe(listener: () => void): () => void;
  shutdown(): Promise<void>;
}

export async function createBossTimerCoordinator(
  options: BossTimerCoordinatorOptions,
): Promise<BossTimerCoordinator> {
  const now = options.now ?? Date.now;
  const timers = new Map<string, BossTimer>();
  const listeners = new Set<() => void>();
  const catalogBosses = queryMobRewardCatalog(loadBundledMobRewardCatalog(), { boss: true });
  const pickableBosses: BossCatalogOption[] = catalogBosses
    .map((boss) => ({ mobId: boss.id, displayName: boss.displayName, level: boss.level }))
    .sort((left, right) => left.level - right.level || left.displayName.localeCompare(right.displayName));
  const bossNames = new Map(pickableBosses.map((boss) => [boss.mobId, boss.displayName]));
  let shuttingDown = false;
  let currentInstanceId: string | undefined;
  let playerName: string | undefined;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;

  const persistence = new SafeSaveQueue<BossTimer[]>({
    label: "boss timers",
    // `snapshotTimers` builds a fresh array per schedule that nothing mutates afterwards.
    clone: false,
    save: (value) => saveBossTimers(value, options.storagePath),
    onWarning: (warning) => options.onWarning?.(warning),
  });

  for (const timer of await loadBossTimers(options.storagePath)) {
    // Legacy region keys can normalize to one timer, so keep the newest.
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
    for (const listener of listeners) listener();
  }

  function setPlayerName(next: string | undefined): void {
    const trimmed = next?.trim();
    const resolved = trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
    if (shuttingDown || resolved === playerName) return;
    playerName = resolved;
    for (const listener of listeners) listener();
  }

  function recordGravestone(gravestone: BossGravestoneObservation): void {
    if (shuttingDown) return;
    if (!gravestone.mobId || !gravestone.bossName || !Number.isFinite(gravestone.diedAtMs)) return;
    if (gravestone.channel !== undefined && !isBossChannel(gravestone.channel)) return;
    const region = bossRegionOf(gravestone.instanceId);
    const diedAtMs = Math.min(gravestone.diedAtMs, now());
    if (region === undefined && gravestone.channel === undefined
      && isDeathAlreadyPlaced(gravestone.mobId, diedAtMs)) return;
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
  if (candidate.channel !== undefined && !isBossChannel(candidate.channel)) return undefined;
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
