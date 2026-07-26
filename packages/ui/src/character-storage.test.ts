import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CharacterSnapshot } from "@kar-mi/spirit-vale-tools-character";
import { CURRENT_GAME_BUILD_FINGERPRINT } from "@kar-mi/spirit-vale-tools-capture";
import {
  activeCharacterSnapshot,
  loadCharacterCache,
  saveCharacterCache,
  updateCharacterCache,
} from "./character-storage.ts";

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

  test("loads the legacy single-character format into the new cache", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-character-legacy-"));
    const file = path.join(directory, "character.json");
    try {
      await writeFile(file, JSON.stringify(snapshot("Fictional Ranger", ["Scout", "Ranger"])), "utf8");

      const restored = await loadCharacterCache(file);
      expect(restored).toMatchObject({
        activeName: "Fictional Ranger",
        characters: [{ name: "Fictional Ranger", source: "cached" }],
      });

      await saveCharacterCache(restored, file);
      expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
        cacheVersion: 1,
        activeName: "Fictional Ranger",
        characters: [{ name: "Fictional Ranger" }],
      });
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
