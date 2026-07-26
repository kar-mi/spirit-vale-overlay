import { describe, expect, test } from "bun:test";

import { SafeSaveQueue, STORAGE_WARNING } from "./safe-save.ts";

describe("safe save queue", () => {
  test("contains failures, reports a warning, and clears it after retry", async () => {
    let attempts = 0;
    const warnings: Array<string | undefined> = [];
    const errors: string[] = [];
    const queue = new SafeSaveQueue<number>({
      label: "synthetic settings",
      save: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("synthetic write failure");
      },
      onWarning: (warning) => warnings.push(warning),
      onError: (message) => errors.push(message),
    });

    queue.schedule(1);
    await expect(queue.flush()).resolves.toBeUndefined();
    expect(warnings).toEqual([STORAGE_WARNING]);
    expect(errors[0]).toContain("synthetic write failure");

    await expect(queue.flush()).resolves.toBeUndefined();
    expect(attempts).toBe(2);
    expect(warnings).toEqual([STORAGE_WARNING, undefined]);
  });

  test("coalesces pending values and serializes writes", async () => {
    const writes: number[] = [];
    let active = 0;
    let maximumActive = 0;
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const queue = new SafeSaveQueue<number>({
      label: "synthetic settings",
      save: async (value) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        writes.push(value);
        if (value === 1) await firstGate;
        active -= 1;
      },
      onWarning: () => {},
    });

    queue.schedule(1);
    const firstFlush = queue.flush();
    await Bun.sleep(1);
    queue.schedule(2);
    queue.schedule(3);
    const finalFlush = queue.flush();
    releaseFirst?.();
    await Promise.all([firstFlush, finalFlush]);

    expect(writes).toEqual([1, 3]);
    expect(maximumActive).toBe(1);
  });
});
