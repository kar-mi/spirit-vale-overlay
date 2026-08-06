import { XpAggregateTracker } from "@kar-mi/spirit-vale-tools-rewards";
import type { XpAggregateSnapshot } from "@kar-mi/spirit-vale-tools-rewards";
import type { CoinsAggregateSnapshot } from "@spiritvale/overlay";
import { JsonlTailReader, LiveLogSessionFollower, parseLogRecord } from "@kar-mi/spirit-vale-tools-logging";

const POLL_MS = 1_000;

/**
 * Owns the single, app-wide Character XP and Gold trackers: the overlay tiles and the Rewards
 * window's XP Tracker tab all read from (and can reset) these same instances, so they never show
 * diverging totals and a reset from either place is immediately reflected in the others. Runs its
 * own poll loop independent of either window being open, so XP and gold keep accumulating even if
 * both are closed. In-memory only — the totals reset whenever the app itself is (re)launched.
 */
export interface XpTrackerCoordinator {
  getSnapshot(): XpAggregateSnapshot;
  getCoinsSnapshot(): CoinsAggregateSnapshot;
  reset(): void;
  resetCoins(): void;
  subscribe(listener: () => void): () => void;
  shutdown(): void;
}

export function createXpTrackerCoordinator(options: { logDirectory: string }): XpTrackerCoordinator {
  const tracker = new XpAggregateTracker();
  // Gold shares the XP tracker's aggregation semantics (EWMA rate, per-hour buckets, watermark
  // dedup) — the tracker is a generic value accumulator, so a second instance fed with the coins
  // field of the same kill records gives the same behavior.
  const coinsTracker = new XpAggregateTracker();
  // A fresh follower replays the current rewards log from the beginning. Establish a launch-time
  // watermark first so an in-memory tracker does not resurrect XP or gold from the previous app run.
  tracker.reset(Date.now());
  coinsTracker.reset(Date.now());
  const listeners = new Set<() => void>();

  const follower = new LiveLogSessionFollower<ExperienceLogFollower, void>({
    stream: "rewards",
    logDirectory: options.logDirectory,
    createFollower: (path) => new ExperienceLogFollower(path, {
      onExperience: (experience, recordedAtMs) => {
        tracker.record(experience, recordedAtMs);
        notify();
      },
      onCoins: (coins, recordedAtMs) => {
        coinsTracker.record(coins, recordedAtMs);
        notify();
      },
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
    getCoinsSnapshot: () => toCoinsSnapshot(coinsTracker.snapshot(Date.now())),
    reset: () => {
      tracker.reset(Date.now());
      notify();
    },
    resetCoins: () => {
      coinsTracker.reset(Date.now());
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

/** Follows only the two scalar fields needed by the XP and gold trackers and retains no reward history. */
class ExperienceLogFollower {
  private readonly reader: JsonlTailReader;

  constructor(
    path: string,
    private readonly handlers: {
      onExperience: (experience: number, recordedAtMs: number) => void;
      onCoins: (coins: number, recordedAtMs: number) => void;
    },
  ) {
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
      const recordedAtMs = Date.parse(record.recordedAt);
      if (!Number.isFinite(recordedAtMs)) continue;
      const experience = record.data["experience"];
      if (typeof experience === "number" && Number.isFinite(experience) && experience > 0) {
        this.handlers.onExperience(experience, recordedAtMs);
      }
      const coins = parseCoins(record.data["coins"]);
      if (coins !== undefined && coins > 0) {
        this.handlers.onCoins(coins, recordedAtMs);
      }
    }
  }
}

/** Coins are logged as decimal strings (bigint serialized). Undefined when not a valid decimal. */
function parseCoins(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toCoinsSnapshot(snapshot: XpAggregateSnapshot): CoinsAggregateSnapshot {
  return {
    totalCoins: snapshot.totalExperience,
    coinsPerSecond: snapshot.xpPerSecond,
    coinsPerHour: snapshot.xpPerHour,
    timeline: snapshot.timeline.map(({ atMs, experience }) => ({ atMs, coins: experience })),
  };
}
