export class OverlayPublishCadence {
  private activeMeter = false;
  private lastMeterPublishMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly meterIntervalMs: number) {}

  observeEvents(): void {
    this.activeMeter = true;
  }

  recordMeterState(active: boolean): void {
    this.activeMeter = active;
  }

  hasActiveMeter(): boolean {
    return this.activeMeter;
  }

  shouldPublishMeter(nowMs: number, force = false): boolean {
    if (!force && (!this.activeMeter || nowMs - this.lastMeterPublishMs < this.meterIntervalMs)) return false;
    this.lastMeterPublishMs = nowMs;
    return true;
  }

  reset(): void {
    this.activeMeter = false;
    this.lastMeterPublishMs = Number.NEGATIVE_INFINITY;
  }
}
