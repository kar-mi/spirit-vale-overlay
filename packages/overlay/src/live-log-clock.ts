export class OverlayLogClock {
  private offsetMs = 0;
  private lastObservedAtMs?: number;
  private lastWallMs?: number;

  constructor(private readonly wallClock: () => number = Date.now) {}

  observe(observedAtMs: number): number {
    const timelineMs = observedAtMs + this.offsetMs;
    // Never move the projected timeline backward across log rotations.
    if (timelineMs >= (this.nowMs() ?? Number.NEGATIVE_INFINITY)) {
      this.lastObservedAtMs = timelineMs;
      this.lastWallMs = this.wallClock();
    }
    return timelineMs;
  }

  nowMs(): number | undefined {
    if (this.lastObservedAtMs === undefined || this.lastWallMs === undefined) return undefined;
    return this.lastObservedAtMs + (this.wallClock() - this.lastWallMs);
  }

  rotate(): void {
    const nowMs = this.nowMs();
    if (nowMs === undefined) return;
    this.offsetMs = nowMs;
    this.lastObservedAtMs = nowMs;
    this.lastWallMs = this.wallClock();
  }
}
