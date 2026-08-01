export type Dispose = () => void;

/** Owns subscriptions and other resources that must be released as one lifecycle. */
export class DisposableStore {
  private readonly disposers = new Set<Dispose>();
  private disposed = false;

  add(dispose: Dispose): Dispose {
    if (this.disposed) {
      dispose();
      return () => {};
    }
    let active = true;
    const tracked = (): void => {
      if (!active) return;
      active = false;
      this.disposers.delete(tracked);
      dispose();
    };
    this.disposers.add(tracked);
    return tracked;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of [...this.disposers].reverse()) dispose();
    this.disposers.clear();
  }
}
