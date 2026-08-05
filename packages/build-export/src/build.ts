/**
 * The spiritvalers.com v:2 build payload — the exact shape the planner's `applyBuild()` reads.
 *
 * The planner sanitizes whatever it is handed (clamping levels, attributes, refines and substats),
 * so this type describes the contract rather than a guarantee. Producing a field it does not know
 * is harmless; producing a field in the wrong shape is not, because the planner will drop it
 * silently rather than fail loudly.
 */

export interface V2Substat {
  stat: string;
  base: number;
  /** Scopes the stat to a skill or element. Empty string when unscoped. */
  q: string;
}

export interface V2Equipment {
  id: string;
  refine: number;
  /** Positional, padded to the item's card-slot count with nulls. */
  cards: Array<string | null>;
  /** Positional, padded to the item's substat count with nulls; the chaos roll is the last index. */
  subs: Array<V2Substat | null>;
}

export interface V2Artifact {
  id: string;
  refine: number;
  gem: string | null;
  gemRefine: number;
  subs: Array<V2Substat | null>;
}

export type V2SlotId =
  | "mainhand" | "offhand" | "head" | "eyewear" | "chest"
  | "back" | "legs" | "feet" | "acc1" | "acc2";
export type V2ArtifactSlotId = "rune" | "jewel" | "scroll" | "relic";
export type V2Attributes = Record<"STR" | "VIT" | "AGI" | "DEX" | "INT" | "LUK", number>;

export interface V2Build {
  v: 2;
  /** The site's class slug. */
  cls: string;
  /** The base class an advanced class advanced from, when they differ. */
  base?: string;
  name: string;
  overview: string;
  lv: number;
  job: number;
  attr: V2Attributes;
  eq: Partial<Record<V2SlotId, V2Equipment>>;
  arti: Record<V2ArtifactSlotId, V2Artifact | null>;
  skills: Record<string, number>;
  grim: Array<string | null>;
  /** Gunslinger weapon-swap sets A/B/C, from the game's Normal/Secondary/Heavy loadouts. */
  wload?: Array<{ mainhand: V2Equipment | null; offhand: V2Equipment | null }>;
  wset?: number;
  _gameBuild?: string;
  _savedAt?: string;
  _src?: { site: "companion"; app: string; v: number; character?: string };
}

export const V2_ARTIFACT_SLOTS: readonly V2ArtifactSlotId[] = ["rune", "jewel", "scroll", "relic"];
export const V2_ATTRIBUTES = ["STR", "VIT", "AGI", "DEX", "INT", "LUK"] as const;
export const GRIMOIRE_SLOTS = 3;

/**
 * `CharacterEquipment.slot` -> build slot id. The decoder resolves the game's numeric `EquipSlot`
 * to these display names, so this map is keyed off the names rather than the indices.
 */
export const EQUIPMENT_SLOT_TO_V2: Record<string, V2SlotId> = {
  "Main hand": "mainhand",
  "Off hand": "offhand",
  Head: "head",
  Legs: "legs",
  Feet: "feet",
  Chest: "chest",
  "Left accessory": "acc1",
  "Right accessory": "acc2",
  Eyewear: "eyewear",
  Back: "back",
};

/** `CharacterArtifact.slot` -> build artifact slot id. */
export const ARTIFACT_SLOT_TO_V2: Record<string, V2ArtifactSlotId> = {
  Rune: "rune",
  Jewel: "jewel",
  Scroll: "scroll",
  Relic: "relic",
};
