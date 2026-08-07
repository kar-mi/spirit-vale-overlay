import type { FishNetActiveStatus } from "@kar-mi/spirit-vale-tools-combat";

/**
 * How long a status the server dropped stays on screen in case it is re-applied.
 *
 * The server churns the group boons a nearby player projects: it sends an explicit remove and
 * re-applies the same status a fraction of a second later, sometimes for several actors in the same
 * millisecond. Honouring that faithfully is right for the data model but reads as a blink, so the
 * render side holds the chip for one refresh cycle's worth of absence. Measured over a live session,
 * re-applications land within ~0.45s; a second covers them without holding a genuinely lapsed buff
 * long enough to notice.
 */
export const STATUS_LINGER_MS = 1_000;

interface HeldStatus {
  status: FishNetActiveStatus;
  /** When the status stopped being reported, or undefined while it is still active. */
  absentSinceMs?: number;
}

/**
 * Smooths momentary gaps in the toggles tile.
 *
 * Only statuses published without an `expiresAtMs` are lingered - the toggles bucket, which is where
 * the churn was observed. Re-showing a timed buff would mean rendering a frozen or negative
 * countdown, so those pass through untouched.
 */
export class OverlayStatusLinger {
  private readonly held = new Map<string, HeldStatus>();

  constructor(private readonly windowMs: number = STATUS_LINGER_MS) {}

  /**
   * The statuses to render: everything currently active, plus anything untimed that went missing
   * within the linger window. Idempotent for a given `nowMs`, because the overlay derives its status
   * state both when the view asks for it and when the tracker changes.
   */
  apply(statuses: readonly FishNetActiveStatus[], nowMs: number): FishNetActiveStatus[] {
    const present = new Set<string>();
    for (const status of statuses) {
      present.add(status.statusId);
      if (status.expiresAtMs === undefined) this.held.set(status.statusId, { status });
    }
    const result = [...statuses];
    for (const [statusId, entry] of this.held) {
      if (present.has(statusId)) continue;
      // The hold is timed from when the status went missing rather than from when it was last seen,
      // which keeps it independent of how often this runs. The overlay projects when the tracker
      // changes, not on a fixed clock, and a removal is itself a tracker change - so the absence is
      // noticed as it happens, and a quiet stretch beforehand cannot eat into the hold.
      entry.absentSinceMs ??= nowMs;
      if (nowMs - entry.absentSinceMs > this.windowMs) {
        this.held.delete(statusId);
        continue;
      }
      result.push(entry.status);
    }
    // The tracker hands its statuses over in application order and the tiles render them that way,
    // so a re-inserted chip has to fall back into place rather than jumping to the end and back.
    return result.sort((left, right) => left.appliedAtMs - right.appliedAtMs);
  }

  /**
   * When the next held-but-absent chip is due to drop, or undefined while nothing is being held.
   *
   * This is a deadline the overlay has to wake for: no log event will announce it, because it is the
   * *absence* of one.
   */
  nextDeadlineMs(): number | undefined {
    let earliest: number | undefined;
    for (const entry of this.held.values()) {
      if (entry.absentSinceMs === undefined) continue;
      const deadline = entry.absentSinceMs + this.windowMs;
      if (earliest === undefined || deadline < earliest) earliest = deadline;
    }
    return earliest;
  }

  /** Discards what was being held, e.g. when the tracked character changes. */
  reset(): void {
    this.held.clear();
  }
}
