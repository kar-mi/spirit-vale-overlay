import { describe, expect, test } from "bun:test";
import type { CharacterSnapshot } from "@kar-mi/spirit-vale-tools-character";
import { CURRENT_GAME_BUILD_FINGERPRINT } from "@kar-mi/spirit-vale-tools-capture";

import { InspectedCharacterStore } from "./inspected-character-store.ts";

describe("inspected character store", () => {
  test("upserts case-insensitive IGNs and searches name or class", () => {
      const store = new InspectedCharacterStore(":memory:");
      store.upsert({ snapshot: snapshot("Fictional Mage", "Mage", 21), inspectedAt: "2026-08-10T12:00:00.000Z" });
      store.upsert({ snapshot: snapshot("fictional mage", "Wizard", 22), inspectedAt: "2026-08-11T12:00:00.000Z" });
      store.upsert({ snapshot: snapshot("Fictional Ranger", "Ranger", 30), inspectedAt: "2026-08-09T12:00:00.000Z" });

      expect(store.list().map((entry) => [entry.snapshot.name, entry.snapshot.level])).toEqual([
        ["fictional mage", 22], ["Fictional Ranger", 30],
      ]);
      expect(store.list("WIZ").map((entry) => entry.snapshot.name)).toEqual(["fictional mage"]);
      expect(store.list("ranger").map((entry) => entry.snapshot.name)).toEqual(["Fictional Ranger"]);
      expect(store.delete("FICTIONAL MAGE")).toBe(true);
      expect(store.list()).toHaveLength(1);
      store.clear();
      expect(store.list()).toHaveLength(0);
      store.close();
  });
});

function snapshot(name: string, cls: string, level: number): CharacterSnapshot {
  return {
    schemaVersion: 1, buildFingerprint: CURRENT_GAME_BUILD_FINGERPRINT, name,
    archetypes: [cls], level, experience: 0, jobLevel: 1, jobExperience: 0,
    attributes: { STR: 1, VIT: 1, AGI: 1, DEX: 1, INT: 1, LUK: 1 },
    activeLoadout: "Normal", equipment: [], artifacts: [], skills: [],
    updatedAt: "2026-08-11T12:00:00.000Z", source: "live",
  };
}
