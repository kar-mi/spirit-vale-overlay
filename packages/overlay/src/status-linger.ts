import type { FishNetActiveStatus } from "@kar-mi/spirit-vale-tools-combat";

export const STATUS_LINGER_MS = 1_000;

interface HeldStatus {
  status: FishNetActiveStatus;
  absentSinceMs?: number;
}

export class OverlayStatusLinger {
  private readonly held = new Map<string, HeldStatus>();

  constructor(private readonly windowMs: number = STATUS_LINGER_MS) {}

  apply(statuses: readonly FishNetActiveStatus[], nowMs: number): FishNetActiveStatus[] {
    const present = new Set<string>();
    for (const status of statuses) {
      present.add(status.statusId);
      if (status.expiresAtMs === undefined) this.held.set(status.statusId, { status });
    }
    const result = [...statuses];
    for (const [statusId, entry] of this.held) {
      if (present.has(statusId)) continue;
      // Start the hold when the status disappears, independent of update cadence.
      entry.absentSinceMs ??= nowMs;
      if (nowMs - entry.absentSinceMs > this.windowMs) {
        this.held.delete(statusId);
        continue;
      }
      result.push(entry.status);
    }
    return result.sort((left, right) => left.appliedAtMs - right.appliedAtMs);
  }

  nextDeadlineMs(): number | undefined {
    let earliest: number | undefined;
    for (const entry of this.held.values()) {
      if (entry.absentSinceMs === undefined) continue;
      const deadline = entry.absentSinceMs + this.windowMs;
      if (earliest === undefined || deadline < earliest) earliest = deadline;
    }
    return earliest;
  }

  reset(): void {
    this.held.clear();
  }
}
