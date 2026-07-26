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
});

class FakeWindow {
  shown = 0;
  activated = 0;
  closed = 0;
  show(): void { this.shown += 1; }
  activate(): void { this.activated += 1; }
  close(): void { this.closed += 1; }
}
