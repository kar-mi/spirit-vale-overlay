import { describe, expect, test } from "bun:test";
import type { CharacterSnapshot } from "@kar-mi/spirit-vale-tools-character";

import { personalExperience } from "./personal-experience.ts";
import { resourceFill } from "./personal-resources.ts";

const requirements = [40, 196, 500];

describe("overlay personal experience", () => {
  test("maps character and job progress through the shared game requirement table", () => {
    expect(personalExperience(snapshot({
      level: 2,
      experience: 46,
      jobLevel: 3,
      jobExperience: 125,
    }), requirements)).toEqual({
      characterXp: { current: 46, maximum: 196, capped: false },
      jobXp: { current: 125, maximum: 500, capped: false },
    });
  });

  test("shows capped tracks as full zero-over-zero bars", () => {
    const progress = personalExperience(snapshot({
      level: 150,
      experience: 99,
      jobLevel: 70,
      jobExperience: 88,
    }), requirements);

    expect(progress).toEqual({
      characterXp: { current: 0, maximum: 0, capped: true },
      jobXp: { current: 0, maximum: 0, capped: true },
    });
    expect(resourceFill(progress.characterXp!)).toBe(1);
    expect(resourceFill(progress.jobXp!)).toBe(1);
  });

  test("waits for unavailable or invalid progress and clamps overfilled bars", () => {
    expect(personalExperience(undefined, requirements)).toEqual({});
    expect(personalExperience(snapshot({
      level: 0,
      experience: -1,
      jobLevel: 4,
      jobExperience: 0,
    }), requirements)).toEqual({});
    expect(resourceFill({ current: 250, maximum: 196 })).toBe(1);
  });
});

function snapshot(overrides: Pick<CharacterSnapshot, "level" | "experience" | "jobLevel" | "jobExperience">): CharacterSnapshot {
  return {
    schemaVersion: 1,
    buildFingerprint: "test",
    name: "Tester",
    archetypes: ["Mage"],
    attributes: { STR: 1, VIT: 1, AGI: 1, DEX: 1, INT: 1, LUK: 1 },
    activeLoadout: "Normal",
    equipment: [],
    artifacts: [],
    skills: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "live",
    ...overrides,
  };
}
