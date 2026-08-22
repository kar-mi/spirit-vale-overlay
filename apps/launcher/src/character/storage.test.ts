import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CharacterSnapshot } from "@kar-mi/spirit-vale-tools-character";
import { CURRENT_GAME_BUILD_FINGERPRINT } from "@kar-mi/spirit-vale-tools-capture";
import {
  activeCharacterSnapshot,
  loadCharacterCache,
  normalizeCharacterSnapshot,
  saveCharacterCache,
  updateCharacterCache,
} from "./storage.ts";

describe("character cache storage", () => {
  test("retains multiple characters and restores the last active one", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-character-cache-"));
    const file = path.join(directory, "characters.json");
    try {
      let cache = updateCharacterCache({ characters: [] }, snapshot("Fictional Warrior", ["Warrior", "Berserker"]));
      cache = updateCharacterCache(cache, snapshot("Fictional Mage", ["Mage", "Wizard"]));
      await saveCharacterCache(cache, file);

      const restored = await loadCharacterCache(file);
      expect(restored.characters.map(({ name }) => name)).toEqual(["Fictional Warrior", "Fictional Mage"]);
      expect(activeCharacterSnapshot(restored)).toMatchObject({
        name: "Fictional Mage",
        archetypes: ["Mage", "Wizard"],
        source: "cached",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("ignores the retired single-character format", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-character-retired-"));
    const file = path.join(directory, "character.json");
    try {
      await writeFile(file, JSON.stringify(snapshot("Fictional Ranger", ["Scout", "Ranger"])), "utf8");

      const restored = await loadCharacterCache(file);
      expect(restored).toEqual({ characters: [] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("can restore an inspected snapshot from an older game build when explicitly allowed", () => {
    const cached = snapshot("Fictional Ranger", ["Scout", "Ranger"]);
    cached.buildFingerprint = "older-game-build";
    expect(normalizeCharacterSnapshot(cached)).toBeUndefined();
    expect(normalizeCharacterSnapshot(cached, { requireCurrentBuildFingerprint: false })).toMatchObject({
      name: "Fictional Ranger",
      buildFingerprint: "older-game-build",
      source: "cached",
    });
  });

  test("round-trips grimoires, the action bar and stored loadouts", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-character-cache-"));
    const file = path.join(directory, "characters.json");
    try {
      const live = snapshot("Fictional Gunslinger", ["Scout", "Gunslinger"]);
      live.grimoires = [{ slot: "Grimoire 2", itemId: "Scout_2", refine: 0, cards: [], substats: [] }];
      live.assignedSkills = [{ id: "Mount", displayName: "Mount", level: 1, effects: [] }];
      live.loadouts = [[], [{ slot: "Main hand", itemId: "Thundercoil", refine: 7, cards: [], substats: [] }], []];

      await saveCharacterCache(updateCharacterCache({ characters: [] }, live), file);
      const restored = activeCharacterSnapshot(await loadCharacterCache(file));

      expect(restored?.grimoires).toEqual(live.grimoires);
      expect(restored?.assignedSkills).toEqual(live.assignedSkills);
      expect(restored?.loadouts?.[1]?.[0]?.itemId).toBe("Thundercoil");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function snapshot(name: string, archetypes: string[]): CharacterSnapshot {
  return {
    schemaVersion: 1,
    buildFingerprint: CURRENT_GAME_BUILD_FINGERPRINT,
    name,
    archetypes,
    level: 42,
    experience: 0,
    jobLevel: 18,
    jobExperience: 0,
    attributes: { STR: 20, VIT: 20, AGI: 20, DEX: 20, INT: 20, LUK: 20 },
    activeLoadout: "Normal",
    equipment: [],
    artifacts: [],
    skills: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "live",
  };
}
