import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { RewardSessionLogFollower, XpAggregateTracker } from "@kar-mi/spirit-vale-tools-rewards";
import type { XpAggregateSnapshot } from "@kar-mi/spirit-vale-tools-rewards";
import { SafeSaveQueue } from "@spiritvale/ui-core/safe-save";

const POLL_MS = 1_000;

interface XpTrackerCheckpointFile {
  schemaVersion: 1;
  total: number;
  watermarkMs: number;
  watermarkOccurrences: number;
}

/**
 * Owns the single, app-wide Character XP tracker: the overlay tile and the Rewards window's XP
 * Tracker tab both read from (and can reset) this same instance, so they never show diverging
 * totals and a reset from either place is immediately reflected in the other. Runs its own poll
 * loop independent of either window being open, so XP keeps accumulating even if both are closed.
 */
export interface XpTrackerCoordinator {
  getSnapshot(): XpAggregateSnapshot;
  reset(): void;
  subscribe(listener: () => void): () => void;
  shutdown(): Promise<void>;
}

export async function createXpTrackerCoordinator(options: {
  logDirectory: string;
  settingsPath: string;
  onWarning?: (warning: string | undefined) => void;
}): Promise<XpTrackerCoordinator> {
  const checkpoint = await loadCheckpoint(options.settingsPath);
  const tracker = new XpAggregateTracker();
  tracker.restoreCheckpoint({
    total: checkpoint.total,
    watermarkMs: checkpoint.watermarkMs,
    watermarkOccurrences: checkpoint.watermarkOccurrences,
  });

  const listeners = new Set<() => void>();
  const persistence = new SafeSaveQueue<XpTrackerCheckpointFile>({
    label: "xp tracker checkpoint",
    save: (value) => saveCheckpoint(value, options.settingsPath),
    onWarning: (warning) => options.onWarning?.(warning),
  });

  const follower = new RewardSessionLogFollower(options.logDirectory, {
    onExperience: (experience, recordedAtMs) => {
      tracker.record(experience, recordedAtMs);
      persistCheckpoint();
      notify();
    },
  });

  let polling = false;
  let shuttingDown = false;
  const timer = setInterval(() => void poll(), POLL_MS);
  void poll();

  function persistCheckpoint(): void {
    const value = tracker.currentCheckpoint();
    persistence.schedule({ schemaVersion: 1, ...value });
  }

  function notify(): void {
    for (const listener of listeners) listener();
  }

  async function poll(): Promise<void> {
    if (polling || shuttingDown) return;
    polling = true;
    try {
      await follower.poll();
    } catch {
      // The overlay/Rewards windows' own combat/rewards log readers already surface read errors.
    } finally {
      polling = false;
    }
  }

  return {
    getSnapshot: () => tracker.snapshot(Date.now()),
    reset: () => {
      tracker.reset(Date.now());
      persistCheckpoint();
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    shutdown: async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      clearInterval(timer);
      await persistence.flush();
    },
  };
}

async function loadCheckpoint(settingsPath: string): Promise<XpTrackerCheckpointFile> {
  try {
    const candidate = JSON.parse(await readFile(settingsPath, "utf8")) as unknown;
    if (isCheckpointFile(candidate)) return candidate;
  } catch {
    // Missing or invalid file: start from a fresh checkpoint.
  }
  return { schemaVersion: 1, total: 0, watermarkMs: 0, watermarkOccurrences: 0 };
}

async function saveCheckpoint(value: XpTrackerCheckpointFile, settingsPath: string): Promise<void> {
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isCheckpointFile(value: unknown): value is XpTrackerCheckpointFile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<XpTrackerCheckpointFile>;
  return candidate.schemaVersion === 1
    && typeof candidate.total === "number" && Number.isFinite(candidate.total) && candidate.total >= 0
    && typeof candidate.watermarkMs === "number" && Number.isFinite(candidate.watermarkMs) && candidate.watermarkMs >= 0
    && typeof candidate.watermarkOccurrences === "number" && Number.isFinite(candidate.watermarkOccurrences) && candidate.watermarkOccurrences >= 0;
}
