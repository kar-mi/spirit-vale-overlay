
export const ATTRIBUTION = [
  "Derived from spiritvalers.com game-data catalogs.",
  "Source: https://spiritvalers.com \u2014 used under the Interoperability Snapshot grant.",
  "Generated data; not an official SpiritVale data set.",
] as const;

export interface SubstatPoolEntry {
  stat: string;
  value: number;
  q?: string;
}

export interface SnapshotEquipment {
  slot: string;
  cardSlots: number;
  substatPool?: string;
}

export interface SnapshotSkill {
  id: string;
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
