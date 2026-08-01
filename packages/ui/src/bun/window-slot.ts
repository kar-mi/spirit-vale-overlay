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
    // The slot is cleared only by the window that owns it. A close notification can arrive after a
    // replacement window has already been opened; clearing unconditionally would drop the *new*
    // window from the slot and let the next open() create a duplicate.
    let created: T | undefined;
    this.opening ??= Promise.resolve(this.factory(() => {
      if (created !== undefined && this.window === created) this.window = undefined;
    }));
    try {
      this.window = created = await this.opening;
    } finally {
      this.opening = undefined;
    }
  }

  async withWindow<R>(callback: (window: T) => R | Promise<R>): Promise<R> {
    if (!this.window) await this.open();
    return callback(this.window!);
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
