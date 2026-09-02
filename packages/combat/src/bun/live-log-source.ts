import { DpsLogFollower, DpsSessionLogFollower } from "@kar-mi/spirit-vale-tools-combat";
import type { DpsLogBatch } from "@kar-mi/spirit-vale-tools-combat";

export interface LiveLogSource {
  next(): Promise<DpsLogBatch>;
  close(): void;
}

export function createLiveLogSource(
  logDirectory: string,
  overridePath: string | undefined,
  pollMs: number,
): LiveLogSource {
  if (overridePath === undefined) {
    const follower = new DpsSessionLogFollower(logDirectory);
    return { next: () => follower.next(), close: () => follower.close() };
  }
  const follower = new DpsLogFollower(overridePath);
  return {
    next: async () => {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      return follower.poll();
    },
    close: () => {},
  };
}
