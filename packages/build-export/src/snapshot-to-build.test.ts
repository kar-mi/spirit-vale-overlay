import { describe, expect, test } from "bun:test";
import type { CharacterEquipment, CharacterSnapshot, CharacterSubstat } from "@kar-mi/spirit-vale-tools-character";
import { snapshotToBuild } from "./snapshot-to-build.ts";

/** StatType codes used below, from the pinned snapshot: Dex 3, Luk 5, Def 11, Crit 15, AtkMult 69. */
const DEX = 3;
const CRIT = 15;
const ATK_MULT = 69;

function substat(type: number, roll: number, extra: Partial<CharacterSubstat> = {}): CharacterSubstat {
  return { type, name: `Stat ${type}`, roll, percent: false, ...extra };
}

function character(overrides: Partial<CharacterSnapshot> = {}): CharacterSnapshot {
  return {
    schemaVersion: 1,
    buildFingerprint: "test",
    name: "Buh",
    archetypes: ["Scout", "Gunslinger"],
    level: 121,
    experience: 0,
    jobLevel: 70,
    jobExperience: 0,
    attributes: { STR: 1, VIT: 1, AGI: 99, DEX: 99, INT: 1, LUK: 60 },
    activeLoadout: "Normal",
    equipment: [],
    artifacts: [],
    skills: [],
    updatedAt: "2026-08-04T00:00:00.000Z",
    source: "live",
    ...overrides,
  };
}

function weapon(overrides: Partial<CharacterEquipment> = {}): CharacterEquipment {
  return {
    slot: "Main hand",
    itemId: "Flintlock Pistol",
    refine: 7,
    cards: [],
    substats: [],
    ...overrides,
  };
}

describe("class resolution", () => {
  test("takes the advanced job and records the base path it came from", () => {
    const { build } = snapshotToBuild(character());
    expect(build.cls).toBe("Gunslinger");
    expect(build.base).toBe("Scout");
  });

  test("a base-only character records no separate base path", () => {
    const { build } = snapshotToBuild(character({ archetypes: ["Scout"] }));
    expect(build.cls).toBe("Scout");
    expect(build.base).toBeUndefined();
  });

  test("an unreleased archetype is reported, and Novice is not noise", () => {
    const { unresolved } = snapshotToBuild(character({ archetypes: ["Novice", "Scout", "Jester"] }));
    expect(unresolved.classes).toEqual(["Jester"]);
  });
});

describe("equipment", () => {
  test("maps game slot names onto planner slot ids", () => {
    const { build } = snapshotToBuild(character({
      equipment: [weapon(), weapon({ slot: "Left accessory", itemId: "Amber Bow" })],
    }));
    expect(Object.keys(build.eq).sort()).toEqual(["acc1", "mainhand"]);
    expect(build.eq.mainhand?.refine).toBe(7);
  });

  test("an item the catalog does not know is reported, never guessed", () => {
    const { build, unresolved, missing } = snapshotToBuild(character({
      equipment: [weapon({ itemId: "Definitely Not A Real Item" })],
    }));
    expect(build.eq.mainhand).toBeUndefined();
    expect(unresolved.equipment).toEqual(["mainhand: Definitely Not A Real Item"]);
    expect(missing).toBe(1);
  });

  test("refine is clamped into the range the planner accepts", () => {
    const { build } = snapshotToBuild(character({ equipment: [weapon({ refine: 99 })] }));
    expect(build.eq.mainhand?.refine).toBe(10);
  });
});

describe("cards", () => {
  test("keeps the socket an empty card sits in", () => {
    const { build } = snapshotToBuild(character({
      equipment: [weapon({ cards: ["Alien Cyclops"], cardsBySlot: [null, "Alien Cyclops"] })],
    }));
    expect(build.eq.mainhand?.cards).toEqual([null, "Alien Cyclops"]);
  });

  test("pads to the item's socket count so the planner renders every slot", () => {
    // Flintlock Pistol has two card slots.
    const { build } = snapshotToBuild(character({ equipment: [weapon({ cards: [] })] }));
    expect(build.eq.mainhand?.cards).toEqual([null, null]);
  });

  test("an unknown card empties its socket and is reported", () => {
    const { build, unresolved } = snapshotToBuild(character({
      equipment: [weapon({ cards: ["Not A Card"], cardsBySlot: ["Not A Card", null] })],
    }));
    expect(build.eq.mainhand?.cards).toEqual([null, null]);
    expect(unresolved.cards).toEqual(["Flintlock Pistol: Not A Card"]);
  });
});

describe("substats", () => {
  test("scales rolls into the values the game displays", () => {
    const { build } = snapshotToBuild(character({
      equipment: [weapon({ substats: [substat(CRIT, 100), substat(DEX, 0)] })],
    }));
    expect(build.eq.mainhand?.subs.slice(0, 2)).toEqual([
      { stat: "Crit", base: 10, q: "" },
      { stat: "Dex", base: 2, q: "" },
    ]);
  });

  test("moves the chaos roll to the last slot and leaves the others in place", () => {
    // Without this the chaos roll lands in slot 2 and the planner treats it as a normal roll.
    const { build } = snapshotToBuild(character({
      equipment: [weapon({
        chaosType: 4,
        substats: [substat(CRIT, 100, { index: 0 }), substat(DEX, 100, { index: 1 }), substat(ATK_MULT, 0, { index: 2 })],
      })],
    }));
    const subs = build.eq.mainhand!.subs;
    expect(subs).toHaveLength(6);
    expect(subs[0]).toEqual({ stat: "Crit", base: 10, q: "" });
    expect(subs[1]).toEqual({ stat: "Dex", base: 3, q: "" });
    expect(subs[2]).toBeNull();
    expect(subs[5]).toEqual({ stat: "AtkMult", base: 3, q: "" });
  });

  test("without a chaos type every roll stays at its wire position", () => {
    const { build } = snapshotToBuild(character({
      equipment: [weapon({
        chaosType: -1,
        substats: [substat(CRIT, 100, { index: 0 }), substat(ATK_MULT, 100, { index: 2 })],
      })],
    }));
    const subs = build.eq.mainhand!.subs;
    expect(subs[1]).toBeNull();
    expect(subs[2]).toEqual({ stat: "AtkMult", base: 5, q: "" });
    expect(subs[5]).toBeNull();
  });

  test("a stat the item's pool cannot roll is reported, not written at zero", () => {
    const { build, unresolved } = snapshotToBuild(character({
      equipment: [weapon({ slot: "Chest", itemId: "ArcaneChest", substats: [substat(CRIT, 100)] })],
    }));
    expect(build.eq.chest?.subs.every((sub) => sub === null)).toBe(true);
    expect(unresolved.substats).toEqual(["ArcaneChest: Crit"]);
  });

  test("carries the qualifier that scopes a stat to one skill", () => {
    const { build } = snapshotToBuild(character({
      equipment: [weapon({ substats: [substat(CRIT, 100, { qualifier: "FanFire" })] })],
    }));
    // The qualifier is part of the pool key, so an unscoped Crit entry must not match it.
    expect(build.eq.mainhand?.subs[0]).toBeNull();
    expect(build.eq.mainhand?.subs).toHaveLength(6);
  });
});

describe("artifacts and gems", () => {
  test("places a piece in its slot with its socketed gem", () => {
    const { build } = snapshotToBuild(character({
      artifacts: [{
        slot: "Rune",
        itemId: "Acolyte",
        refine: 5,
        gems: [{ id: "AerialShot Gem", refine: 3 }],
        substats: [],
      }],
    }));
    expect(build.arti.rune).toMatchObject({ id: "Acolyte", refine: 5, gem: "AerialShot Gem", gemRefine: 3 });
    expect(build.arti.jewel).toBeNull();
  });

  test("reports gems beyond the first socket, which the planner cannot hold", () => {
    const { unresolved } = snapshotToBuild(character({
      artifacts: [{
        slot: "Rune",
        itemId: "Acolyte",
        refine: 0,
        gems: [{ id: "AerialShot Gem", refine: 0 }, { id: "AerialShot Gem", refine: 0 }],
        substats: [],
      }],
    }));
    expect(unresolved.gems).toEqual(["Acolyte: AerialShot Gem (extra socket)"]);
  });

  test("artifact pieces get four substat slots and no chaos slot", () => {
    const { build } = snapshotToBuild(character({
      artifacts: [{ slot: "Jewel", itemId: "Acolyte", refine: 0, gems: [], substats: [substat(ATK_MULT, 100)] }],
    }));
    expect(build.arti.jewel?.subs).toHaveLength(4);
    expect(build.arti.jewel?.subs[0]).toEqual({ stat: "AtkMult", base: 2, q: "" });
  });
});

describe("grimoires", () => {
  test("keeps a book in the slot the game put it in", () => {
    const { build } = snapshotToBuild(character({
      grimoires: [{ slot: "Grimoire 2", itemId: "Acolyte_1", refine: 0, cards: [], substats: [] }],
    }));
    expect(build.grim).toEqual([null, "Acolyte_1", null]);
  });

  test("always reports three slots even with no books", () => {
    expect(snapshotToBuild(character()).build.grim).toEqual([null, null, null]);
  });
});

describe("skills", () => {
  test("resolves game skill ids to the site's route slugs", () => {
    const { build } = snapshotToBuild(character({
      skills: [
        { id: "FanFire", displayName: "Fan Fire", level: 5, effects: [] },
        { id: "ShrapnelShot", displayName: "Shrapnel", level: 5, effects: [] },
      ],
    }));
    // ShrapnelShot -> "shrapnel" is editorial and not derivable from the game id.
    expect(build.skills).toEqual({ "fan-fire": 5, shrapnel: 5 });
  });

  test("spans the base tree the character advanced from", () => {
    const { build, unresolved } = snapshotToBuild(character({
      skills: [{ id: "ArrowShower", displayName: "Arrow Shower", level: 10, effects: [] }],
    }));
    expect(build.skills["arrow-shower"]).toBe(10);
    expect(unresolved.skills).toEqual([]);
  });

  test("a skill outside the class tree is reported rather than invented", () => {
    const { build, unresolved } = snapshotToBuild(character({
      skills: [{ id: "Mount", displayName: "Mount", level: 1, effects: [] }],
    }));
    expect(build.skills).toEqual({});
    expect(unresolved.skills).toEqual(["Mount (level 1)"]);
  });

  test("unspent skills never reach the build", () => {
    const { build } = snapshotToBuild(character({
      skills: [{ id: "FanFire", displayName: "Fan Fire", level: 0, effects: [] }],
    }));
    expect(build.skills).toEqual({});
  });
});

describe("weapon swap sets", () => {
  const loadouts = [
    [],
    [weapon({ itemId: "Flintlock Pistol" })],
    [weapon({ itemId: "Launcher" })],
  ];

  test("maps a Gunslinger's stored loadouts to the planner's three sets", () => {
    const { build } = snapshotToBuild(character({ loadouts, activeLoadout: "Heavy" }));
    expect(build.wload?.[0]).toEqual({ mainhand: null, offhand: null });
    // Full item objects, not bare ids: the planner drops anything without an `id` property.
    expect(build.wload?.[1]?.mainhand).toMatchObject({ id: "Flintlock Pistol", refine: 7 });
    expect(build.wload?.[2]?.mainhand).toMatchObject({ id: "Launcher" });
    expect(build.wset).toBe(2);
  });

  test("ignores loadouts on a class the planner does not model swapping for, and says so", () => {
    const { build, notes } = snapshotToBuild(character({ archetypes: ["Scout"], loadouts }));
    expect(build.wload).toBeUndefined();
    expect(notes.join(" ")).toContain("Gunslinger");
  });

  test("omits the sets entirely when nothing is stored", () => {
    expect(snapshotToBuild(character()).build.wload).toBeUndefined();
  });
});

describe("build envelope", () => {
  test("falls back to a stored loadout when the worn list is empty, and says so", () => {
    const { build, notes } = snapshotToBuild(character({
      loadouts: [[weapon()], [], []],
    }));
    expect(build.eq.mainhand?.id).toBe("Flintlock Pistol");
    expect(notes.join(" ")).toContain("worn-gear list was empty");
  });

  test("stamps the game build the catalog snapshot came from", () => {
    const { build } = snapshotToBuild(character());
    expect(build._gameBuild).toMatch(/^\d+$/);
    expect(build._src).toMatchObject({ site: "companion", app: "spirit-vale-overlay", character: "Buh" });
  });

  test("clamps level, job and attributes into the planner's accepted ranges", () => {
    const { build } = snapshotToBuild(character({
      level: 9_999,
      jobLevel: 9_999,
      attributes: { STR: -5, VIT: 0, AGI: 500, DEX: 1, INT: 1, LUK: 1 },
    }));
    expect(build.lv).toBe(150);
    expect(build.job).toBe(70); // Gunslinger's maxJobLevel
    expect(build.attr).toMatchObject({ STR: 1, VIT: 1, AGI: 99 });
  });

  test("a clean character reports nothing missing", () => {
    const { missing } = snapshotToBuild(character({
      equipment: [weapon({ substats: [substat(CRIT, 100)] })],
      skills: [{ id: "FanFire", displayName: "Fan Fire", level: 5, effects: [] }],
    }));
    expect(missing).toBe(0);
  });
});
