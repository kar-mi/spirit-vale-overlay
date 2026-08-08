import { describe, expect, test } from "bun:test";

import { validSelectedEnemyIds } from "./analysis-selection.ts";

describe("analysis selection handoff", () => {
  test("keeps unique selected enemies that are available for the player", () => {
    expect(validSelectedEnemyIds([20, 10, 20, 30], new Set([10, 20]))).toEqual([20, 10]);
  });

  test("preserves an empty selection as the all-enemies default", () => {
    expect(validSelectedEnemyIds([], new Set([10, 20]))).toEqual([]);
  });
});
