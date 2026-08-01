import { describe, expect, test } from "bun:test";

import { DisposableStore } from "./disposable-store.ts";

describe("DisposableStore", () => {
  test("releases resources once in reverse registration order", () => {
    const released: number[] = [];
    const store = new DisposableStore();
    store.add(() => released.push(1));
    const releaseSecond = store.add(() => released.push(2));

    releaseSecond();
    releaseSecond();
    store.dispose();
    store.dispose();

    expect(released).toEqual([2, 1]);
  });

  test("immediately releases a resource added after disposal", () => {
    let released = 0;
    const store = new DisposableStore();
    store.dispose();
    store.add(() => { released += 1; });
    expect(released).toBe(1);
  });
});
