export const STORAGE_WARNING = "Changes could not be saved. Check that the app data folder is writable; the app will retry on the next change.";

export interface SafeSaveQueueOptions<T> {
  save(value: T): Promise<void>;
  onWarning(warning: string | undefined): void;
  label: string;
  delayMs?: number;
  onError?: (message: string) => void;
}

/** Serializes debounced persistence and contains write failures so UI processes stay alive. */
export class SafeSaveQueue<T> {
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: T;
  private latest?: T;
  private hasLatest = false;
  private failed = false;
  private warningActive = false;
  private tail: Promise<void> = Promise.resolve();
  private readonly delayMs: number;

  constructor(private readonly options: SafeSaveQueueOptions<T>) {
    this.delayMs = options.delayMs ?? 250;
    if (!Number.isFinite(this.delayMs) || this.delayMs < 0) throw new RangeError("save delay must be non-negative");
  }

  schedule(value: T): void {
    this.stage(value);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.submitPending();
    }, this.delayMs);
  }

  async flush(): Promise<void>;
  async flush(value: T): Promise<void>;
  async flush(value?: T): Promise<void> {
    if (arguments.length > 0) this.stage(value as T);
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const submitted = this.submitPending();
    await this.tail;
    if (!submitted && this.failed && this.hasLatest) {
      this.enqueue(structuredClone(this.latest as T));
      await this.tail;
    }
  }

  private stage(value: T): void {
    const snapshot = structuredClone(value);
    this.latest = snapshot;
    this.hasLatest = true;
    this.pending = snapshot;
  }

  private submitPending(): boolean {
    if (this.pending === undefined) return false;
    const value = this.pending;
    this.pending = undefined;
    this.enqueue(value);
    return true;
  }

  private enqueue(value: T): void {
    this.tail = this.tail.then(() => this.attempt(value));
  }

  private async attempt(value: T): Promise<void> {
    try {
      await this.options.save(value);
      this.failed = false;
      this.setWarning(false);
    } catch (error) {
      this.failed = true;
      const detail = error instanceof Error ? error.message : String(error);
      try {
        (this.options.onError ?? console.error)(`[spiritvale-storage] ${this.options.label}: ${detail}`);
      } catch {
        // Error reporting must not turn a contained save failure into an unhandled rejection.
      }
      this.setWarning(true);
    }
  }

  private setWarning(active: boolean): void {
    if (active === this.warningActive) return;
    this.warningActive = active;
    try {
      this.options.onWarning(active ? STORAGE_WARNING : undefined);
    } catch {
      // UI publication is best effort and must not poison the save queue.
    }
  }
}
