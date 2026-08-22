export interface ManagedWindow {
  show(): void | Promise<void>;
  activate(): void | Promise<void>;
  close(): void | Promise<void>;
}

export class WindowSlot<T extends ManagedWindow> {
  private window?: T;
  private opening?: Promise<T>;

  constructor(private readonly factory: (onClosed: () => void) => T | Promise<T>) {}

  get current(): T | undefined {
    return this.window;
  }

  async open(): Promise<void> {
    if (this.window) {
      try {
        await this.window.show();
        await this.window.activate();
        return;
      } catch {
        this.window = undefined;
      }
    }
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
