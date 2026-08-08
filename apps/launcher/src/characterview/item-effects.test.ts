import { expect, test } from "bun:test";
import { formatItemEffect } from "./item-effects.ts";

test("renders typed item-effect targets with their stat semantics", () => {
  expect(formatItemEffect({ type: 26, value: 50, target: { kind: "status", id: "Bleeding" } })).toBe("Resistance to Bleeding +50");
  expect(formatItemEffect({ type: 44, value: 10, target: { kind: "element", id: "Fire" } })).toBe("Damage to Fire +10%");
  expect(formatItemEffect({ type: 42, value: 3, target: { kind: "skill", id: "Heal" } })).toBe("Grants Heal Lv 3");
  expect(formatItemEffect({ type: 49, value: 5, target: { kind: "skill", id: "Bash" } })).toBe("Bash damage +5%");
  expect(formatItemEffect({ type: 211, value: 15, target: { kind: "status", id: "Poison" } })).toBe("Poison duration +15");
});
