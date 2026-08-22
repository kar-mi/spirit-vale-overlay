import { RateTracker } from "@kar-mi/spirit-vale-tools-metrics";
import type { RateSnapshot } from "@kar-mi/spirit-vale-tools-metrics";
import type { RateTotals } from "@svoverlay/overlay";
import {
  isLogStreamHeader,
  JsonlTailReader,
  LiveLogSessionFollower,
  parseLogRecord,
} from "@kar-mi/spirit-vale-tools-logging";
import type { JsonlTailReadResult } from "@kar-mi/spirit-vale-tools-logging";

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

  const follower = new LiveLogSessionFollower<ExperienceLogFollower, void>({
    stream: "rewards",
    logDirectory: options.logDirectory,
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

class ExperienceLogFollower {
  private readonly reader: JsonlTailReader;

  constructor(
    path: string,
    private readonly onKill: (experience: number, coins: number, recordedAtMs: number) => void,
  ) {
    this.reader = new JsonlTailReader(path);
  }

  async poll(): Promise<void> {
    this.consumeRead(await this.reader.read());
  }

  consumeRead({ missing, lines }: JsonlTailReadResult): void {
    if (missing) return;
    for (const line of lines) {
      if (!line.trim()) continue;
      let candidate: unknown;
      try { candidate = JSON.parse(line); } catch { continue; }
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

function parseCoins(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
