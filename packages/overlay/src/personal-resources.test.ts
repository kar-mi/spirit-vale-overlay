import { describe, expect, test } from "bun:test";

import { personalResources, resourceFill } from "./personal-resources.ts";

describe("overlay personal resources", () => {
  test("maps complete live health and mana pairs", () => {
    expect(personalResources({
      currentHealth: 750,
      maxHealth: 1_000,
      currentMana: 0,
      maxMana: 240,
    })).toEqual({
      health: { current: 750, maximum: 1_000 },
      mana: { current: 0, maximum: 240 },
    });
  });

  test("waits for complete positive-maximum pairs", () => {
    expect(personalResources({
      currentHealth: 750,
      maxMana: 0,
      currentMana: 12,
    })).toEqual({});
  });

  test("clamps the visual fill without changing resource values", () => {
    expect(resourceFill({ current: 150, maximum: 100 })).toBe(100);
    expect(resourceFill({ current: 0, maximum: 100 })).toBe(0);
  });
});
