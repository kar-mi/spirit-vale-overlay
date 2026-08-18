import { expect, test } from "bun:test";

import { classDisplayForArchetype, classIconUrlForArchetype, classIconUrlForName } from "./class-display.ts";

test("maps every supported archetype to a class name and shared artwork URL", () => {
  const expected = new Map([
    [0, "Warrior"], [1, "Mage"], [2, "Rogue"], [3, "Knight"], [4, "Summoner"],
    [5, "Acolyte"], [6, "Scout"], [10, "Paladin"], [12, "Berserker"], [14, "Priest"],
    [16, "Wizard"], [21, "Shinobi"], [22, "Gunslinger"], [26, "Necromancer"], [31, "Weaver"],
  ]);
  for (const [archetype, name] of expected) {
    const display = classDisplayForArchetype(archetype);
    expect(display.name).toBe(name);
    expect(display.iconUrl).toBe(classIconUrlForName(name));
    expect(display.iconUrl).toBe(classIconUrlForArchetype(archetype));
  }
});

test("keeps neutral displays and leaves image-only fallback policy to callers", () => {
  expect(classDisplayForArchetype(undefined)).toEqual({ name: "Unknown" });
  expect(classDisplayForArchetype(999)).toEqual({ name: "Unknown" });
  expect(classIconUrlForArchetype(undefined)).toBeUndefined();
  expect(classIconUrlForName("Not a class")).toBeUndefined();
});
