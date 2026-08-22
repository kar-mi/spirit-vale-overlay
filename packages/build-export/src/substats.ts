
import type { BuildExportSnapshot, SnapshotEquipment } from "./catalog.ts";

const ATTRIBUTE_STATS: Record<string, true> = { Str: true, Vit: true, Agi: true, Dex: true, Int: true, Luk: true };

const WEAPON_SLOTS: Record<string, true> = {
  Sword: true, Dagger: true, Wand: true, Spear: true, Axe: true, Mace: true, Book: true,
  Pistol: true, Twinblade: true, Katar: true,
  Bow: true, Scythe: true, Instrument: true, Rifle: true, Shotgun: true, Launcher: true, GatlingGun: true,
};

export const ARTIFACT_ITEM: SnapshotEquipment = { slot: "Artifact", cardSlots: 0, substatPool: "Artifact" };

export function maxSubstats(item: SnapshotEquipment | undefined): number {
  if (!item) return 4;
  if (item.slot === "Artifact") return 4;
  return WEAPON_SLOTS[item.slot] ? 6 : 5;
}

export function chaosSlotIndex(item: SnapshotEquipment | undefined): number {
  if (!item || item.slot === "Artifact") return -1;
  return maxSubstats(item) - 1;
}

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
