import type { FishNetActiveStatus } from "@kar-mi/spirit-vale-tools-combat";
import { loadBundledStatusCatalog, statusDurationSeconds } from "@kar-mi/spirit-vale-tools-statuses";

export const SUMMON_OPTIONS: readonly RequiredStatusOption[] = [
  { statusId: "ShadowSeal", displayName: "Shadow Seal", spriteId: "Rogue18" },
  { statusId: "SummonAbomination", displayName: "Summon Abomination", spriteId: "SummonAbomination" },
  { statusId: "SummonAngel", displayName: "Summon Angel", spriteId: "Light03" },
  { statusId: "SummonCactus", displayName: "Summon Cactus", spriteId: "Cactus03" },
  { statusId: "SummonCat", displayName: "Summon Cat", spriteId: "Cat03" },
  { statusId: "SummonDeathMage", displayName: "Summon Death Mage", spriteId: "Dark03" },
  { statusId: "SummonReanimation", displayName: "Summon Reanimation", spriteId: "Necromancer12" },
  { statusId: "SummonSkeleton", displayName: "Summon Skeleton", spriteId: "Skeleton01" },
  { statusId: "SummonSkeletonMage", displayName: "Summon Skeleton Mage", spriteId: "Skeleton02" },
  { statusId: "SummonWolf", displayName: "Summon Wolf", spriteId: "Wolf03" },
  { statusId: "SummonWraith", displayName: "Summon Wraith", spriteId: "Reaper03" },
];

export const REQUIRED_STATUS_CATEGORIES = ["buffs", "toggles"] as const;
export type RequiredStatusCategory = (typeof REQUIRED_STATUS_CATEGORIES)[number];

export interface RequiredStatusOption {
  statusId: string;
  displayName: string;
  spriteId: string;
}

const OPTIONS_BY_CATEGORY: Record<RequiredStatusCategory, readonly RequiredStatusOption[]> = buildOptions();

export function requiredStatusOptions(category: RequiredStatusCategory): readonly RequiredStatusOption[] {
  return OPTIONS_BY_CATEGORY[category];
}

export function normalizeRequiredStatusIds(category: RequiredStatusCategory, value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const selectable = new Set(OPTIONS_BY_CATEGORY[category].map((option) => option.statusId));
  const kept = new Set(value.filter((entry): entry is string => typeof entry === "string" && selectable.has(entry)));
  return [...kept].sort();
}

export function missingRequiredStatuses(
  requiredIds: readonly string[],
  active: readonly FishNetActiveStatus[],
): string[] {
  if (requiredIds.length === 0) return [];
  const activeIds = new Set(active.map((status) => status.statusId));
  return requiredIds.filter((statusId) => !activeIds.has(statusId));
}

function buildOptions(): Record<RequiredStatusCategory, readonly RequiredStatusOption[]> {
  const buffs: RequiredStatusOption[] = [];
  const toggles: RequiredStatusOption[] = [];
  for (const definition of loadBundledStatusCatalog().statuses) {
    if (definition.isDebuff || definition.spriteId === undefined) continue;
    const option = {
      statusId: definition.id,
      displayName: definition.displayName,
      spriteId: definition.spriteId,
    };
    // Whether a status is timed does not vary by level in the bundled catalog, so level 1 is enough to decide which tile it lands in.
    if (statusDurationSeconds(definition, 1) === undefined) toggles.push(option);
    else buffs.push(option);
  }
  toggles.push(...SUMMON_OPTIONS);
  return { buffs: sortByName(buffs), toggles: sortByName(toggles) };
}

function sortByName(options: RequiredStatusOption[]): readonly RequiredStatusOption[] {
  return options.sort((left, right) => left.displayName.localeCompare(right.displayName));
}
