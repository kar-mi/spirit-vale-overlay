import { XpAggregateTracker } from "@kar-mi/spirit-vale-tools-rewards";
import type { XpAggregateSnapshot } from "@kar-mi/spirit-vale-tools-rewards";
import { JsonlTailReader, LiveLogSessionFollower, parseLogRecord } from "@kar-mi/spirit-vale-tools-logging";

const POLL_MS = 1_000;

/**
 * Owns the single, app-wide Character XP tracker: the overlay tile and the Rewards window's XP
 * Tracker tab both read from (and can reset) this same instance, so they never show diverging
 * totals and a reset from either place is immediately reflected in the other. Runs its own poll
 * loop independent of either window being open, so XP keeps accumulating even if both are closed.
 * In-memory only — the total resets whenever the app itself is (re)launched.
 */
export interface XpTrackerCoordinator {
  getSnapshot(): XpAggregateSnapshot;
  reset(): void;
  subscribe(listener: () => void): () => void;
  shutdown(): void;
}

export function createXpTrackerCoordinator(options: { logDirectory: string }): XpTrackerCoordinator {
  const tracker = new XpAggregateTracker();
  // A fresh follower replays the current rewards log from the beginning. Establish a launch-time
  // watermark first so an in-memory tracker does not resurrect XP from the previous app run.
  tracker.reset(Date.now());
  const listeners = new Set<() => void>();

  const follower = new LiveLogSessionFollower<ExperienceLogFollower, void>({
    stream: "rewards",
    logDirectory: options.logDirectory,
    createFollower: (path) => new ExperienceLogFollower(path, (experience, recordedAtMs) => {
      tracker.record(experience, recordedAtMs);
      notify();
    }),
    mergeSessionChange: (batch) => batch,
    noStreamBatch: () => {},
  });

  let polling = false;
  let shuttingDown = false;
  const timer = setInterval(() => void poll(), POLL_MS);
  void poll();

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
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    shutdown: () => {
      if (shuttingDown) return;
      shuttingDown = true;
      clearInterval(timer);
    },
  };
}

/** Follows only the two scalar fields needed by the XP tracker and retains no reward history. */
class ExperienceLogFollower {
  private readonly reader: JsonlTailReader;

  constructor(path: string, private readonly onExperience: (experience: number, recordedAtMs: number) => void) {
    this.reader = new JsonlTailReader(path);
  }

  async poll(): Promise<void> {
    const { missing, lines } = await this.reader.read();
    if (missing) return;
    for (const line of lines) {
      if (!line.trim()) continue;
      let candidate: unknown;
      try { candidate = JSON.parse(line); } catch { continue; }
      const record = parseLogRecord(candidate);
      if (!record || record.type !== "rewards.kill" || record.data["kind"] !== "kill") continue;
      const experience = record.data["experience"];
      const recordedAtMs = Date.parse(record.recordedAt);
      if (typeof experience === "number" && Number.isFinite(experience) && experience > 0 && Number.isFinite(recordedAtMs)) {
        this.onExperience(experience, recordedAtMs);
      }
    }
  }
}
