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

  test("uses explicitly normalized inferred maxima when authoritative maxima were not sent", () => {
    expect(personalResources({
      currentHealth: 1_000,
      normalizedMaxHp: 1_000,
      currentMana: 240,
      normalizedMaxMp: 240,
    })).toEqual({
      health: { current: 1_000, maximum: 1_000 },
      mana: { current: 240, maximum: 240 },
    });
  });

  test("always prefers authoritative maxima over inferred normalized values", () => {
    expect(personalResources({
      currentHealth: 900,
      maxHealth: 1_200,
      normalizedMaxHp: 1_000,
      currentMana: 200,
      maxMana: 300,
      normalizedMaxMp: 240,
    })).toEqual({
      health: { current: 900, maximum: 1_200 },
      mana: { current: 200, maximum: 300 },
    });
  });

  test("clamps the visual fill without changing resource values", () => {
    expect(resourceFill({ current: 150, maximum: 100 })).toBe(1);
    expect(resourceFill({ current: 0, maximum: 100 })).toBe(0);
  });
});
