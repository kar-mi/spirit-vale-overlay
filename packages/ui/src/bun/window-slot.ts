export interface ManagedWindow {
  show(): void;
  activate(): void;
  close(): void | Promise<void>;
}

/** Lazily creates one window and focuses it on subsequent open requests. */
export class WindowSlot<T extends ManagedWindow> {
  private window?: T;
  private opening?: Promise<T>;

  constructor(private readonly factory: (onClosed: () => void) => T | Promise<T>) {}

  async open(): Promise<void> {
    if (this.window) {
      this.window.show();
      this.window.activate();
      return;
    }
    this.opening ??= Promise.resolve(this.factory(() => { this.window = undefined; }));
    try {
      this.window = await this.opening;
    } finally {
      this.opening = undefined;
    }
  }

  async close(): Promise<void> {
    const pending = this.opening;
    if (!this.window && pending) {
      try {
        this.window = await pending;
      } finally {
        if (this.opening === pending) this.opening = undefined;
      }
    }
    await this.window?.close();
    this.window = undefined;
  }
}
