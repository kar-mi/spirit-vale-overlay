import { describe, expect, test } from "bun:test";

import { WindowSlot } from "./window-slot.ts";

describe("window slot", () => {
  test("creates one window, focuses repeats, and recreates after close", async () => {
    const windows: FakeWindow[] = [];
    let closed: (() => void) | undefined;
    const slot = new WindowSlot((onClosed) => {
      closed = onClosed;
      const window = new FakeWindow();
      windows.push(window);
      return window;
    });

    await slot.open();
    await slot.open();
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ shown: 1, activated: 1 });

    closed?.();
    await slot.open();
    expect(windows).toHaveLength(2);
    await slot.close();
    expect(windows[1]?.closed).toBe(1);
  });

  test("coalesces concurrent creation", async () => {
    let creations = 0;
    let release!: (window: FakeWindow) => void;
    const pending = new Promise<FakeWindow>((resolve) => { release = resolve; });
    const slot = new WindowSlot(() => { creations += 1; return pending; });
    const first = slot.open();
    const second = slot.open();
    release(new FakeWindow());
    await Promise.all([first, second]);
    expect(creations).toBe(1);
  });

  test("closes a window that is still being created", async () => {
    let release!: (window: FakeWindow) => void;
    const pending = new Promise<FakeWindow>((resolve) => { release = resolve; });
    const slot = new WindowSlot(() => pending);
    const opening = slot.open();
    const closing = slot.close();
    const window = new FakeWindow();
    release(window);
    await Promise.all([opening, closing]);
    expect(window.closed).toBe(1);
  });

  test("ignores a stale close from a window that has already been replaced", async () => {
    const windows: FakeWindow[] = [];
    const closers: (() => void)[] = [];
    const slot = new WindowSlot((onClosed) => {
      closers.push(onClosed);
      const window = new FakeWindow();
      windows.push(window);
      return window;
    });

    await slot.open();
    closers[0]?.();
    await slot.open();
    expect(windows).toHaveLength(2);

    closers[0]?.();
    await slot.open();
    expect(windows).toHaveLength(2);
    expect(windows[1]).toMatchObject({ shown: 1, activated: 1 });
  });

  test("recreates a window that was destroyed without notifying the slot", async () => {
    const windows: FakeWindow[] = [];
    const slot = new WindowSlot(() => {
      const window = new FakeWindow();
      windows.push(window);
      return window;
    });

    await slot.open();
    windows[0]!.destroyed = true;

    await slot.open();
    expect(windows).toHaveLength(2);

    await slot.open();
    expect(windows).toHaveLength(2);
    expect(windows[1]).toMatchObject({ shown: 1, activated: 1 });
  });

  test("recreates when reactivating a window whose session has gone", async () => {
    const windows: FakeWindow[] = [];
    const slot = new WindowSlot(() => {
      const window = new FakeWindow();
      windows.push(window);
      return window;
    });

    await slot.open();
    windows[0]!.disconnected = true;

    await slot.open();
    expect(windows).toHaveLength(2);

    await slot.open();
    expect(windows[1]).toMatchObject({ shown: 1, activated: 1 });
  });

  test("runs operations against the managed singleton", async () => {
    const slot = new WindowSlot(() => new FakeWindow());
    const result = await slot.withWindow((window) => {
      window.show();
      return 42;
    });
    expect(result).toBe(42);
    await slot.close();
  });
});

class FakeWindow {
  shown = 0;
  activated = 0;
  closed = 0;
  destroyed = false;
  disconnected = false;
  show(): void {
    if (this.destroyed) throw new Error("Can't show window. Window no longer exists");
    this.shown += 1;
  }
  async activate(): Promise<void> {
    if (this.disconnected) throw new Error("Spirit Vale DPS is not connected.");
    this.activated += 1;
  }
  close(): void { this.closed += 1; }
}
