import { describe, expect, test } from "bun:test";
import { snapshot } from "./catalog.ts";
import { ARTIFACT_ITEM, chaosSlotIndex, maxSubstats, poolValue, scaleRoll } from "./substats.ts";

const pistol = snapshot.equipment["Flintlock Pistol"]!;
const chest = snapshot.equipment.ArcaneChest!;

describe("substat layout", () => {
  test("weapons roll 5+1, other gear 4+1, artifacts a flat 4", () => {
    expect(maxSubstats(pistol)).toBe(6);
    expect(maxSubstats(chest)).toBe(5);
    expect(maxSubstats(ARTIFACT_ITEM)).toBe(4);
  });

  test("the chaos slot is the last index, and artifacts have none", () => {
    expect(chaosSlotIndex(pistol)).toBe(5);
    expect(chaosSlotIndex(chest)).toBe(4);
    expect(chaosSlotIndex(ARTIFACT_ITEM)).toBe(-1);
  });
});

describe("pool values", () => {
  test("resolves a stat from the item's own pool", () => {
    expect(poolValue(snapshot, pistol, "Crit", "")).toBe(10);
    expect(poolValue(snapshot, chest, "Def", "")).toBe(10);
  });

  test("a stat on another slot's pool does not resolve", () => {
    expect(poolValue(snapshot, chest, "Crit", "")).toBeNull();
  });

  test("an item with no pool resolves nothing", () => {
    expect(poolValue(snapshot, { slot: "Grimoire", cardSlots: 0 }, "Crit", "")).toBeNull();
  });
});

describe("roll scaling", () => {
  test("roll 100 is the full pool value and roll 0 the two-thirds floor", () => {
    expect(scaleRoll(snapshot, pistol, "Crit", "", 100)).toBe(10);
    expect(scaleRoll(snapshot, pistol, "Crit", "", 0)).toBe(7);
  });

  test("attributes scale against a fixed value of 3 on any slot", () => {
    expect(scaleRoll(snapshot, chest, "Dex", "", 100)).toBe(3);
    expect(scaleRoll(snapshot, chest, "Dex", "", 0)).toBe(2);
  });

  test("a roll outside 0-100 is clamped rather than extrapolated", () => {
    expect(scaleRoll(snapshot, pistol, "Crit", "", 500)).toBe(scaleRoll(snapshot, pistol, "Crit", "", 100));
    expect(scaleRoll(snapshot, pistol, "Crit", "", -20)).toBe(scaleRoll(snapshot, pistol, "Crit", "", 0));
  });

  test("a stat absent from the pool scales to null instead of zero", () => {
    expect(scaleRoll(snapshot, chest, "Crit", "", 100)).toBeNull();
  });

  test("negative pool values round away from zero", () => {
    const pool = { Test: [[{ stat: "CastTime", value: -10, q: "" }]] };
    const fake = { ...snapshot, pools: { ...snapshot.pools, ...pool } };
    const item = { slot: "Wand", cardSlots: 0, substatPool: "Test" };
    expect(scaleRoll(fake, item, "CastTime", "", 0)).toBe(-7);
  });
});
