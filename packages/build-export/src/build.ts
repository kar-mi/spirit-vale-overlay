
export interface V2Substat {
  stat: string;
  base: number;
  q: string;
}

export interface V2Equipment {
  id: string;
  refine: number;
  cards: Array<string | null>;
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
  cls: string;
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
  wload?: Array<{ mainhand: V2Equipment | null; offhand: V2Equipment | null }>;
  wset?: number;
  _gameBuild?: string;
  _savedAt?: string;
  _src?: { site: "companion"; app: string; v: number; character?: string };
}

export const V2_ARTIFACT_SLOTS: readonly V2ArtifactSlotId[] = ["rune", "jewel", "scroll", "relic"];
export const V2_ATTRIBUTES = ["STR", "VIT", "AGI", "DEX", "INT", "LUK"] as const;
export const GRIMOIRE_SLOTS = 3;

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

export const ARTIFACT_SLOT_TO_V2: Record<string, V2ArtifactSlotId> = {
  Rune: "rune",
  Jewel: "jewel",
  Scroll: "scroll",
  Relic: "relic",
};
