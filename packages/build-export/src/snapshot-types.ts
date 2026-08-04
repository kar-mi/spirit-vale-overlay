/**
 * Shape of the pinned catalog snapshot, split from `catalog.ts` so the generator that WRITES
 * the snapshot can import these types without importing the file it is about to create.
 */

/** Reproduced verbatim in the snapshot as the condition of the site's vendoring grant. */
export const ATTRIBUTION = [
  "Derived from spiritvalers.com game-data catalogs.",
  "Source: https://spiritvalers.com \u2014 used under the Interoperability Snapshot grant.",
  "Generated data; not an official SpiritVale data set.",
] as const;

/** One alternative within a substat pool group. `q` scopes the stat to a skill or element. */
export interface SubstatPoolEntry {
  stat: string;
  value: number;
  q?: string;
}

export interface SnapshotEquipment {
  slot: string;
  cardSlots: number;
  /** Key into `pools`. Absent for gear whose slot rolls no substats. */
  substatPool?: string;
}

export interface SnapshotSkill {
  /** The site's route slug, and the key the planner stores skill points under. */
  id: string;
  /** The `SkillConfig` id the game puts on the wire. */
  gameId?: string;
}

export interface SnapshotClass {
  slug: string;
  gameId: string;
  type: string;
  maxJobLevel: number;
  advancedClasses: string[];
  skills: SnapshotSkill[];
}

export interface BuildExportSnapshot {
  attribution: readonly string[];
  generatedAt: string;
  /** Steam build id the site's data was pulled from; stamped onto exported builds. */
  gameBuild: string;
  gameLabel: string;
  source: string;
  equipment: Record<string, SnapshotEquipment>;
  grimoires: string[];
  cards: string[];
  gems: string[];
  artifacts: string[];
  statTypes: Record<number, string>;
  pools: Record<string, SubstatPoolEntry[][]>;
  classes: SnapshotClass[];
}
