import { RewardSessionLogFollower, XpAggregateTracker } from "@kar-mi/spirit-vale-tools-rewards";
import type { XpAggregateSnapshot } from "@kar-mi/spirit-vale-tools-rewards";

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
  const listeners = new Set<() => void>();

  const follower = new RewardSessionLogFollower(options.logDirectory, {
    onExperience: (experience, recordedAtMs) => {
      tracker.record(experience, recordedAtMs);
      notify();
    },
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
