import type { FishNetActiveStatus } from "@kar-mi/spirit-vale-tools-combat";
import { loadBundledStatusCatalog, statusDurationSeconds } from "@kar-mi/spirit-vale-tools-statuses";

/**
 * Summons are tracked from CalibrateSummons_T and keyed by their *skill* id, so they never appear
 * in the status catalog and land in the toggles tile with no expiry. The skill catalog carries no
 * summon marker either — `SummonWolf` and the `SummonRecall` command are indistinguishable there —
 * so membership is curated by hand and must be extended when the game adds a summon.
 *
 * The name and sprite are inlined rather than resolved from the skill catalog: that catalog is ~90KB
 * of data this renderer would otherwise bundle for eleven rows. `required-statuses.test.ts` checks
 * every row against the catalog, so an upstream rename fails there instead of drifting silently.
 *
 * Excluded on purpose: `SummonAttack`/`SummonRecall`/`SummonSwap` (commands, not summons) and
 * `SummonMount`, whose sprite has no shipped artwork, so its cell is dropped from the overlay and
 * the warning could never be cleared.
 */
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

/**
 * The two status tiles a user can arm with a missing-status warning. Debuffs are excluded on
 * purpose: a missing debuff is good news.
 */
export const REQUIRED_STATUS_CATEGORIES = ["buffs", "toggles"] as const;
export type RequiredStatusCategory = (typeof REQUIRED_STATUS_CATEGORIES)[number];

export interface RequiredStatusOption {
  statusId: string;
  displayName: string;
  spriteId: string;
}

/**
 * Buckets every selectable catalog status the same way the live tiles are filled in
 * `bun/index.ts` (`appState`): non-debuffs with a computed duration are buffs, non-debuffs without
 * one are toggles. Statuses with no `spriteId` never render in the overlay, so offering them here
 * would arm a warning the user could never clear. Keep both sides in sync when the split changes.
 */
const OPTIONS_BY_CATEGORY: Record<RequiredStatusCategory, readonly RequiredStatusOption[]> = buildOptions();

export function requiredStatusOptions(category: RequiredStatusCategory): readonly RequiredStatusOption[] {
  return OPTIONS_BY_CATEGORY[category];
}

/** Drops ids that are unknown, belong to the other category, or came from an older game build. */
export function normalizeRequiredStatusIds(category: RequiredStatusCategory, value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const selectable = new Set(OPTIONS_BY_CATEGORY[category].map((option) => option.statusId));
  const kept = new Set(value.filter((entry): entry is string => typeof entry === "string" && selectable.has(entry)));
  return [...kept].sort();
}

export function emptyRequiredStatuses(): Record<RequiredStatusCategory, string[]> {
  return { buffs: [], toggles: [] };
}

/** The armed statuses that are not currently active, in the order they were configured. */
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
    // Whether a status is timed does not vary by level in the bundled catalog, so level 1 is enough
    // to decide which tile it lands in.
    if (statusDurationSeconds(definition, 1) === undefined) toggles.push(option);
    else buffs.push(option);
  }
  toggles.push(...SUMMON_OPTIONS);
  return { buffs: sortByName(buffs), toggles: sortByName(toggles) };
}

function sortByName(options: RequiredStatusOption[]): readonly RequiredStatusOption[] {
  return options.sort((left, right) => left.displayName.localeCompare(right.displayName));
}
