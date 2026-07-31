import type { CharacterSnapshot } from "@kar-mi/spirit-vale-tools-character";

import type { OverlayExperienceProgress } from "./app-types.ts";

export const CHARACTER_LEVEL_CAP = 150;
export const JOB_LEVEL_CAP = 70;

export interface PersonalExperience {
  characterXp?: OverlayExperienceProgress;
  jobXp?: OverlayExperienceProgress;
}

export function personalExperience(
  snapshot: CharacterSnapshot | undefined,
  requirements: readonly number[],
): PersonalExperience {
  if (!snapshot) return {};
  return {
    ...progress("characterXp", snapshot.level, snapshot.experience, CHARACTER_LEVEL_CAP, requirements),
    ...progress("jobXp", snapshot.jobLevel, snapshot.jobExperience, JOB_LEVEL_CAP, requirements),
  };
}

function progress(
  key: keyof PersonalExperience,
  level: number,
  experience: number,
  cap: number,
  requirements: readonly number[],
): PersonalExperience {
  if (!Number.isInteger(level) || level < 1 || !validExperience(experience)) return {};
  if (level >= cap) return { [key]: { current: 0, maximum: 0, capped: true } };
  const maximum = requirements[level - 1];
  if (!validRequirement(maximum)) return {};
  return { [key]: { current: experience, maximum, capped: false } };
}

function validExperience(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function validRequirement(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
