import { describe, expect, test } from "bun:test";

import { selectionAfterDeathLogRefresh } from "./death-log.ts";

describe("live death log selection", () => {
  test("preserves a selected death while prepending newer deaths", () => {
    expect(selectionAfterDeathLogRefresh("death-1", [{ id: "death-2" }, { id: "death-1" }])).toBe("death-1");
  });

  test("selects the newest death when opening or rotating files", () => {
    expect(selectionAfterDeathLogRefresh(undefined, [{ id: "death-3" }, { id: "death-2" }])).toBe("death-3");
    expect(selectionAfterDeathLogRefresh("missing", [{ id: "death-1" }])).toBe("death-1");
  });
});
