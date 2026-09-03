import { RateTracker } from "@kar-mi/spirit-vale-tools-metrics";
import type { RateSnapshot } from "@kar-mi/spirit-vale-tools-metrics";
import type { RateTotals } from "@svoverlay/overlay";
import { LiveRewardSessionLogFollower } from "@kar-mi/spirit-vale-tools-rewards";

const READ_RETRY_MS = 1_000;

export interface XpTrackerCoordinator {
  getSnapshot(): RateSnapshot;
  getCoinsSnapshot(): RateTotals;
  reset(): void;
  resetCoins(): void;
  subscribe(listener: () => void): () => void;
  shutdown(): void;
}

export function createXpTrackerCoordinator(options: { logDirectory: string }): XpTrackerCoordinator {
  const tracker = new RateTracker();
  const coinsTracker = new RateTracker();
  tracker.reset(Date.now());
  coinsTracker.reset(Date.now());
  const listeners = new Set<() => void>();

  const follower = new LiveRewardSessionLogFollower(options.logDirectory, {
    onGain: ({ experience, coins, recordedAtMs }) => {
      if (experience > 0) tracker.record(experience, recordedAtMs);
      if (coins > 0n) coinsTracker.record(Number(coins), recordedAtMs);
      if (experience > 0 || coins > 0n) notify();
    },
  });

  let shuttingDown = false;
  void follow();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  async function follow(): Promise<void> {
    while (!shuttingDown) {
      try {
        await follower.next();
      } catch {
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
      follower.close();
    },
  };
}
