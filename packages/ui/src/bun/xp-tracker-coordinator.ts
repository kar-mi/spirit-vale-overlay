import { RateTracker } from "@kar-mi/spirit-vale-tools-metrics";
import type { RateSnapshot } from "@kar-mi/spirit-vale-tools-metrics";
import type { RateTotals } from "@spiritvale/overlay";
import {
  isLogStreamHeader,
  JsonlTailReader,
  LiveLogSessionFollower,
  parseLogRecord,
} from "@kar-mi/spirit-vale-tools-logging";
import type { JsonlTailReadResult } from "@kar-mi/spirit-vale-tools-logging";

/** Backoff after a failed read. The follow loop is watcher-driven and has no interval otherwise. */
const READ_RETRY_MS = 1_000;

/**
 * Owns the single, app-wide Character XP and Gold trackers: the overlay tiles and the Rewards
 * window's XP Tracker tab all read from (and can reset) these same instances, so they never show
 * diverging totals and a reset from either place is immediately reflected in the others. Runs its
 * own poll loop independent of either window being open, so XP and gold keep accumulating even if
 * both are closed. In-memory only — the totals reset whenever the app itself is (re)launched.
 */
export interface XpTrackerCoordinator {
  getSnapshot(): RateSnapshot;
  /** Totals only: nothing charts gold, and its timeline is an hour of buckets nobody reads. */
  getCoinsSnapshot(): RateTotals;
  reset(): void;
  resetCoins(): void;
  subscribe(listener: () => void): () => void;
  shutdown(): void;
}

export function createXpTrackerCoordinator(options: { logDirectory: string }): XpTrackerCoordinator {
  const tracker = new RateTracker();
  // Gold shares the XP tracker's aggregation semantics (EWMA rate, per-hour buckets, watermark
  // dedup) — the tracker is a generic value accumulator, so a second instance fed with the coins
  // field of the same kill records gives the same behavior, reported through the same shape.
  const coinsTracker = new RateTracker();
  // A fresh follower replays the current rewards log from the beginning. Establish a launch-time
  // watermark first so an in-memory tracker does not resurrect XP or gold from the previous app run.
  tracker.reset(Date.now());
  coinsTracker.reset(Date.now());
  const listeners = new Set<() => void>();

  const follower = new LiveLogSessionFollower<ExperienceLogFollower, void>({
    stream: "rewards",
    logDirectory: options.logDirectory,
    // One callback per kill record: both trackers are fed from the same record and a single
    // notify() fires per record, so a kill carrying XP and gold publishes exactly once. The
    // notify is gated on either value being non-zero: at max level a kill can still carry gold
    // (0 XP + 100 gold must publish), while a record with neither (e.g. an unattributed kill)
    // should not emit an event.
    createFollower: (path) => new ExperienceLogFollower(path, (experience, coins, recordedAtMs) => {
      if (experience > 0) tracker.record(experience, recordedAtMs);
      if (coins > 0) coinsTracker.record(coins, recordedAtMs);
      if (experience > 0 || coins > 0) notify();
    }),
    mergeSessionChange: (batch) => batch,
    noStreamBatch: () => {},
  });

  let shuttingDown = false;
  void follow();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  /**
   * Follows the rewards log for the life of the app.
   *
   * The follower wakes on a filesystem event rather than on a timer, so the trackers cost nothing
   * between kills. `close()` settles a parked `next()`, which is what unwinds this on shutdown.
   */
  async function follow(): Promise<void> {
    while (!shuttingDown) {
      try {
        await follower.next();
      } catch {
        // The overlay/Rewards windows' own combat/rewards log readers already surface read errors.
        // Back off rather than spinning: whatever failed will not be fixed by retrying at once.
        await new Promise((resolve) => setTimeout(resolve, READ_RETRY_MS));
      }
    }
  }

  return {
    getSnapshot: () => tracker.snapshot(Date.now()),
    getCoinsSnapshot: () => {
      const { timeline: _timeline, ...totals } = coinsTracker.snapshot(Date.now());
      return totals;
    },
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
      // Releases this consumer's hold on the shared log source, which disposes its watchers and
      // fallback timer once the last consumer lets go. It also unblocks the follow loop.
      follower.close();
    },
  };
}

/** Follows only the two scalar fields needed by the XP and gold trackers and retains no reward history. */
class ExperienceLogFollower {
  private readonly reader: JsonlTailReader;

  constructor(
    path: string,
    /** Called once per kill record with its (possibly zero) XP and coins. */
    private readonly onKill: (experience: number, coins: number, recordedAtMs: number) => void,
  ) {
    this.reader = new JsonlTailReader(path);
  }

  async poll(): Promise<void> {
    this.consumeRead(await this.reader.read());
  }

  /** Folds a read performed on this follower's behalf (by the shared stream source) into the trackers. */
  consumeRead({ missing, lines }: JsonlTailReadResult): void {
    if (missing) return;
    for (const line of lines) {
      if (!line.trim()) continue;
      let candidate: unknown;
      try { candidate = JSON.parse(line); } catch { continue; }
      // A v2 stream opens with a header line carrying the session id and producer. It is not a
      // record, and readers are expected to skip it rather than treat it as a malformed one.
      if (isLogStreamHeader(candidate)) continue;
      const record = parseLogRecord(candidate);
      if (!record || record.type !== "rewards.kill" || record.data["kind"] !== "kill") continue;
      const recordedAtMs = Date.parse(record.recordedAt);
      if (!Number.isFinite(recordedAtMs)) continue;
      const experience = record.data["experience"];
      const coins = parseCoins(record.data["coins"]) ?? 0;
      this.onKill(
        typeof experience === "number" && Number.isFinite(experience) && experience > 0 ? experience : 0,
        coins,
        recordedAtMs,
      );
    }
  }
}

/**
 * Coins are logged as decimal strings (bigint serialized). Undefined when not a valid decimal.
 *
 * Precision note: the rewards pipeline keeps coins as bigint end-to-end (reward-tracker,
 * live-rewards, log serialization). Converting to Number loses exactness above 2^53 (~9e15) —
 * a single session's gold is unlikely to approach that, but if it ever does the overlay total
 * will diverge from the exact string shown in the Rewards window.
 */
function parseCoins(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
