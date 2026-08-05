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

interface LingeredStatus {
  status: FishNetActiveStatus;
  lastSeenMs: number;
}

/**
 * Smooths momentary gaps in the toggles tile.
 *
 * Only statuses published without an `expiresAtMs` are lingered - the toggles bucket, which is where
 * the churn was observed. Re-showing a timed buff would mean rendering a frozen or negative
 * countdown, so those pass through untouched.
 */
export class OverlayStatusLinger {
  private readonly lingered = new Map<string, LingeredStatus>();

  constructor(private readonly windowMs: number = STATUS_LINGER_MS) {}

  /**
   * The statuses to render: everything currently active, plus anything untimed that was active
   * within the linger window. Idempotent for a given `nowMs`, because the overlay derives its status
   * state both when the view asks for it and on every poll.
   */
  apply(statuses: readonly FishNetActiveStatus[], nowMs: number): FishNetActiveStatus[] {
    const present = new Set<string>();
    for (const status of statuses) {
      present.add(status.statusId);
      if (status.expiresAtMs === undefined) this.lingered.set(status.statusId, { status, lastSeenMs: nowMs });
    }
    const result = [...statuses];
    for (const [statusId, entry] of this.lingered) {
      if (nowMs - entry.lastSeenMs > this.windowMs) {
        this.lingered.delete(statusId);
        continue;
      }
      if (!present.has(statusId)) result.push(entry.status);
    }
    // The tracker hands its statuses over in application order and the tiles render them that way,
    // so a re-inserted chip has to fall back into place rather than jumping to the end and back.
    return result.sort((left, right) => left.appliedAtMs - right.appliedAtMs);
  }

  /** Discards what was being held, e.g. when the tracked character changes. */
  reset(): void {
    this.lingered.clear();
  }
}
