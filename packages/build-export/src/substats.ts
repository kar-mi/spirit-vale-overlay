/**
 * The slice of spiritvalers.com's substat model the exporter needs.
 *
 * The reference implementation is the site's own `wiki-data/substats.js`. This is a deliberate
 * port of three functions from it, NOT a reimplementation of the whole model, because the planner
 * re-runs its own `clampSubs` on every build it loads. Porting the range/quality/odds maths as
 * well would create a third copy of formulas that already exist twice (here and in the site), with
 * nothing to keep them in step — and the planner would overwrite our answer anyway.
 *
 * So the exporter computes the scaled value the game displays and stops there. If a roll is out of
 * range for any reason, the planner clamps it on load exactly as it does for a build restored from
 * the cloud.
 */

import type { BuildExportSnapshot, SnapshotEquipment } from "./catalog.ts";

/** Attributes are not pool members; every slot rolls them against a fixed value of 3. */
const ATTRIBUTE_STATS: Record<string, true> = { Str: true, Vit: true, Agi: true, Dex: true, Int: true, Luk: true };

/**
 * `EquipUtil` weapon slot types. Weapons get the 5+1 substat layout, other gear 4+1, artifacts a
 * flat 4. The "+1" is the chaos slot and is always the last index.
 */
const WEAPON_SLOTS: Record<string, true> = {
  Sword: true, Dagger: true, Wand: true, Spear: true, Axe: true, Mace: true, Book: true,
  Pistol: true, Twinblade: true, Katar: true,
  Bow: true, Scythe: true, Instrument: true, Rifle: true, Shotgun: true, Launcher: true, GatlingGun: true,
};

/** The pseudo-item for an artifact piece: all four pieces share one pool and roll no chaos slot. */
export const ARTIFACT_ITEM: SnapshotEquipment = { slot: "Artifact", cardSlots: 0, substatPool: "Artifact" };

/** Total substat slots on an item, chaos slot included. */
export function maxSubstats(item: SnapshotEquipment | undefined): number {
  if (!item) return 4;
  if (item.slot === "Artifact") return 4;
  return WEAPON_SLOTS[item.slot] ? 6 : 5;
}

/** Index of the chaos slot, or -1 for artifacts, which have none. */
export function chaosSlotIndex(item: SnapshotEquipment | undefined): number {
  if (!item || item.slot === "Artifact") return -1;
  return maxSubstats(item) - 1;
}

/**
 * The item pool's configured value for a stat — its roll-100 value — or null when the stat is not
 * on this item's pool. `qualifier` scopes a stat to one skill or element, so a stat name alone is
 * not a unique key.
 */
export function poolValue(
  snapshot: BuildExportSnapshot,
  item: SnapshotEquipment | undefined,
  stat: string,
  qualifier: string,
): number | null {
  const pool = item?.substatPool ? snapshot.pools[item.substatPool] : undefined;
  if (!pool) return null;
  for (const group of pool) {
    for (const entry of group) {
      if (entry.stat === stat && (entry.q ?? "") === qualifier) return entry.value;
    }
  }
  return null;
}

/**
 * The in-game value of a roll, or null when the stat is not on this item's pool.
 *
 * `Formula$$GetSubstatScaledValue`: `full * (clamp(roll, 0, 100) / 300 + 2/3)`, so roll 0 is the
 * 2/3 floor and roll 100 the pool value. Rounded away from zero because several pool values are
 * negative (reduced cast time and the like) and `Math.round` biases those toward zero.
 */
export function scaleRoll(
  snapshot: BuildExportSnapshot,
  item: SnapshotEquipment | undefined,
  stat: string,
  qualifier: string,
  roll: number,
): number | null {
  const full = ATTRIBUTE_STATS[stat] ? 3 : poolValue(snapshot, item, stat, qualifier);
  if (full === null) return null;
  const scaled = full * (Math.min(100, Math.max(0, roll)) / 300 + 2 / 3);
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
}
