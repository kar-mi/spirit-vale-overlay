/**
 * The overlay's timeline for everything it derives from the combat log.
 *
 * The log follower reports times relative to the first record of the file it is currently tailing,
 * so a session rotation (the reset-session shortcut / Reset button) restarts that clock near zero. State that survives
 * the rotation - the status tracker's active buffs, whose expiries are absolute points on this
 * timeline - would otherwise be stranded in the previous session's numbering and appear frozen.
 * Rotating the clock instead of resetting it keeps the timeline monotonic, so retained timers keep
 * counting down correctly across the boundary.
 */
export class OverlayLogClock {
  private offsetMs = 0;
  private lastObservedAtMs?: number;
  private lastWallMs?: number;

  constructor(private readonly wallClock: () => number = Date.now) {}

  /** Maps a follower-relative time onto the overlay timeline and anchors "now" to it. */
  observe(observedAtMs: number): number {
    const timelineMs = observedAtMs + this.offsetMs;
    // "Now" only ever moves forward. Time extrapolated between polls must not be handed back by an
    // event stamped slightly earlier - across a rotation the replacement session's first record
    // restarts at zero plus the offset, which is a shade behind where the clock has already run to,
    // and giving that back would tick every retained buff timer backwards.
    if (timelineMs >= (this.nowMs() ?? Number.NEGATIVE_INFINITY)) {
      this.lastObservedAtMs = timelineMs;
      this.lastWallMs = this.wallClock();
    }
    return timelineMs;
  }

  /** The current timeline position, extrapolated from wall time since the last event. */
  nowMs(): number | undefined {
    if (this.lastObservedAtMs === undefined || this.lastWallMs === undefined) return undefined;
    return this.lastObservedAtMs + (this.wallClock() - this.lastWallMs);
  }

  /**
   * Carries the timeline over a log-session boundary: the replacement file's zero continues from
   * where the previous session left off. "Now" stays anchored rather than being cleared, so retained
   * timers keep counting during the gap before the first event of the new session arrives - a poll
   * that lands in that gap would otherwise have no time to publish statuses against.
   */
  rotate(): void {
    const nowMs = this.nowMs();
    if (nowMs === undefined) return;
    this.offsetMs = nowMs;
    this.lastObservedAtMs = nowMs;
    this.lastWallMs = this.wallClock();
  }
}
