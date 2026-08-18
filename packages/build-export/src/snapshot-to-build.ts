/**
 * `CharacterSnapshot` (what the game sent) -> v:2 build (what spiritvalers.com loads).
 *
 * Two rules govern everything here:
 *
 * 1. Nothing is invented. An id the snapshot catalog does not know is counted and reported, never
 *    guessed at and never written into the build. A build that silently contains a wrong item is
 *    worse than one that honestly says it dropped two cards.
 * 2. Positions are preserved. The planner's card and substat arrays are positional, and the chaos
 *    substat is identified purely by sitting in the last slot, so packing an array shifts a chaos
 *    roll into a normal slot where it will never be floored correctly.
 */

import type { CharacterEquipment, CharacterSnapshot, CharacterSubstat } from "@kar-mi/spirit-vale-tools-character";

import {
  ARTIFACT_SLOT_TO_V2, EQUIPMENT_SLOT_TO_V2, GRIMOIRE_SLOTS, V2_ARTIFACT_SLOTS, V2_ATTRIBUTES,
  type V2Artifact, type V2ArtifactSlotId, type V2Attributes, type V2Build, type V2Equipment,
  type V2SlotId, type V2Substat,
} from "./build.ts";
import { buildExportCatalog, type BuildExportCatalog, type SnapshotClass, type SnapshotEquipment } from "./catalog.ts";
import { ARTIFACT_ITEM, chaosSlotIndex, maxSubstats, scaleRoll } from "./substats.ts";

export const EXPORT_APP = "spirit-vale-overlay";
export const EXPORT_SOURCE_VERSION = 1;

/** Everything the catalog could not resolve, grouped so the UI can say what was lost and where. */
export interface UnresolvedItems {
  equipment: string[];
  cards: string[];
  artifacts: string[];
  gems: string[];
  grimoires: string[];
  skills: string[];
  substats: string[];
  classes: string[];
}

export interface TranslateResult {
  build: V2Build;
  unresolved: UnresolvedItems;
  /** Total unresolved entries; 0 means the character translated cleanly. */
  missing: number;
  /** Human-readable remarks about choices the translation had to make. */
  notes: string[];
}

export interface TranslateOptions {
  /** Overrides the build name, which otherwise takes the character's name. */
  name?: string;
  catalog?: BuildExportCatalog;
  now?: Date;
}

export function snapshotToBuild(snapshot: CharacterSnapshot, options: TranslateOptions = {}): TranslateResult {
  const catalog = options.catalog ?? buildExportCatalog();
  const unresolved = emptyUnresolved();
  const notes: string[] = [];

  const { cls, base } = resolveClass(snapshot, catalog, unresolved);
  const classData = catalog.classesByGameId[cls];
  const equipment = pickActiveGear(snapshot, notes);

  const build: V2Build = {
    v: 2,
    cls,
    name: [...(options.name ?? snapshot.name ?? "")].slice(0, 60).join(""),
    overview: "",
    lv: clampInt(snapshot.level, 1, 150, 100),
    job: clampInt(snapshot.jobLevel, 1, classData?.maxJobLevel ?? 50, 1),
    attr: translateAttributes(snapshot.attributes),
    eq: translateEquipment(equipment, catalog, unresolved),
    arti: translateArtifacts(snapshot, catalog, unresolved),
    skills: translateSkills(snapshot, classData, catalog, unresolved),
    grim: translateGrimoires(snapshot, catalog, unresolved),
    _src: {
      site: "companion",
      app: EXPORT_APP,
      v: EXPORT_SOURCE_VERSION,
      ...(snapshot.name ? { character: snapshot.name } : {}),
    },
    _savedAt: (options.now ?? new Date()).toISOString(),
  };
  if (base) build.base = base;
  if (catalog.snapshot.gameBuild) build._gameBuild = catalog.snapshot.gameBuild;

  const swap = translateWeaponSets(snapshot, cls, catalog, unresolved, notes);
  if (swap) {
    build.wload = swap.wload;
    build.wset = swap.wset;
  }

  return { build, unresolved, missing: countUnresolved(unresolved), notes };
}

// ------------------------------------------------------------------ class ----

/**
 * `archetypes` is the character's advancement chain. The last playable entry is the job it is now;
 * the first is the base path it took to get there.
 */
function resolveClass(
  snapshot: CharacterSnapshot,
  catalog: BuildExportCatalog,
  unresolved: UnresolvedItems,
): { cls: string; base?: string } {
  const playable = snapshot.archetypes.filter((name) => catalog.classesByGameId[name]);
  for (const name of snapshot.archetypes) {
    if (!catalog.classesByGameId[name] && name !== "Novice") unresolved.classes.push(name);
  }
  const cls = playable.at(-1) ?? "Mage";
  const first = playable.at(0);
  return first && first !== cls ? { cls, base: first } : { cls };
}

function translateAttributes(attributes: CharacterSnapshot["attributes"]): V2Attributes {
  const attr = {} as V2Attributes;
  for (const key of V2_ATTRIBUTES) attr[key] = clampInt(attributes[key], 1, 99, 1);
  return attr;
}

// ------------------------------------------------------------------- gear ----

/**
 * `equipment` is what the character is wearing. A payload can carry an empty worn list alongside a
 * populated active loadout, so fall back rather than exporting a naked character, and say so.
 */
function pickActiveGear(snapshot: CharacterSnapshot, notes: string[]): CharacterEquipment[] {
  if (snapshot.equipment.length) return [...snapshot.equipment];
  const active = snapshot.loadouts?.find((set) => set.length);
  if (!active) return [];
  notes.push("The worn-gear list was empty, so a stored loadout was used instead.");
  return [...active];
}

function translateEquipment(
  equipment: readonly CharacterEquipment[],
  catalog: BuildExportCatalog,
  unresolved: UnresolvedItems,
): Partial<Record<V2SlotId, V2Equipment>> {
  const eq: Partial<Record<V2SlotId, V2Equipment>> = {};
  for (const worn of equipment) {
    const slotId = EQUIPMENT_SLOT_TO_V2[worn.slot];
    if (!slotId) {
      unresolved.equipment.push(`${worn.slot}: ${worn.itemId}`);
      continue;
    }
    const item = catalog.snapshot.equipment[worn.itemId];
    if (!item) {
      unresolved.equipment.push(`${slotId}: ${worn.itemId}`);
      continue;
    }
    eq[slotId] = translateEquipmentEntry(worn, item, catalog, unresolved);
  }
  return eq;
}

/** One worn item -> a planner slot entry. Shared by worn gear and the weapon-swap sets. */
function translateEquipmentEntry(
  worn: CharacterEquipment,
  item: SnapshotEquipment,
  catalog: BuildExportCatalog,
  unresolved: UnresolvedItems,
): V2Equipment {
  return {
    id: worn.itemId,
    refine: clampInt(worn.refine, 0, 10, 0),
    cards: translateCards(worn, item.cardSlots, catalog, unresolved),
    subs: translateSubstats(worn.substats, item, worn.chaosType ?? -1, catalog, unresolved, worn.itemId),
  };
}

/**
 * `cardsBySlot` keeps empty sockets; `cards` is the densified list kept for compatibility. Prefer
 * the positional one so a card in socket 3 does not move to socket 1.
 */
function translateCards(
  worn: CharacterEquipment,
  cardSlots: number,
  catalog: BuildExportCatalog,
  unresolved: UnresolvedItems,
): Array<string | null> {
  const source: Array<string | null> = worn.cardsBySlot ?? worn.cards;
  const cards: Array<string | null> = source.map((cardId) => {
    if (!cardId) return null;
    if (catalog.cards.has(cardId)) return cardId;
    unresolved.cards.push(`${worn.itemId}: ${cardId}`);
    return null;
  });
  while (cards.length < cardSlots) cards.push(null);
  return cards;
}

function translateArtifacts(
  snapshot: CharacterSnapshot,
  catalog: BuildExportCatalog,
  unresolved: UnresolvedItems,
): Record<V2ArtifactSlotId, V2Artifact | null> {
  const arti = { rune: null, jewel: null, scroll: null, relic: null } as Record<V2ArtifactSlotId, V2Artifact | null>;
  for (const artifact of snapshot.artifacts) {
    const slotId = ARTIFACT_SLOT_TO_V2[artifact.slot];
    if (!slotId) {
      unresolved.artifacts.push(`${artifact.slot}: ${artifact.itemId}`);
      continue;
    }
    if (!catalog.artifacts.has(artifact.itemId)) {
      unresolved.artifacts.push(`${slotId}: ${artifact.itemId}`);
      continue;
    }
    // Gems are unique account-wide and socket into at most one piece, so the planner models one
    // gem per artifact. Anything beyond the first socket is reported rather than dropped quietly.
    let gem: string | null = null;
    let gemRefine = 0;
    const [first, ...extra] = artifact.gems;
    if (first) {
      if (catalog.gems.has(first.id)) {
        gem = first.id;
        gemRefine = clampInt(first.refine, 0, 10, 0);
      } else {
        unresolved.gems.push(`${artifact.itemId}: ${first.id}`);
      }
    }
    for (const socket of extra) unresolved.gems.push(`${artifact.itemId}: ${socket.id} (extra socket)`);

    arti[slotId] = {
      id: artifact.itemId,
      refine: clampInt(artifact.refine, 0, 10, 0),
      gem,
      gemRefine,
      subs: translateSubstats(artifact.substats, ARTIFACT_ITEM, -1, catalog, unresolved, artifact.itemId),
    };
  }
  return arti;
}

/** Grimoires are labelled `Grimoire N` by the decoder, which is how an empty slot 1 stays empty. */
function translateGrimoires(
  snapshot: CharacterSnapshot,
  catalog: BuildExportCatalog,
  unresolved: UnresolvedItems,
): Array<string | null> {
  const grim: Array<string | null> = new Array(GRIMOIRE_SLOTS).fill(null);
  for (const [order, book] of (snapshot.grimoires ?? []).entries()) {
    const parsed = /^Grimoire (\d+)$/.exec(book.slot);
    const index = parsed ? Number(parsed[1]) - 1 : order;
    if (index < 0 || index >= GRIMOIRE_SLOTS) continue;
    if (!catalog.grimoires.has(book.itemId)) {
      unresolved.grimoires.push(book.itemId);
      continue;
    }
    grim[index] = book.itemId;
  }
  return grim;
}

/**
 * `{type, roll, qualifier}` -> `{stat, base, q}`, keeping wire positions.
 *
 * The chaos substat is the last one the game sent, and the planner expects it in the last slot of
 * a full-width array. Those are different indices whenever the item is not fully rolled, so the
 * chaos entry is relocated and every other roll stays exactly where the game put it. Gated on
 * `chaosType`, which is -1 when the item has no chaos substat at all.
 */
function translateSubstats(
  substats: readonly CharacterSubstat[],
  item: SnapshotEquipment,
  chaosType: number,
  catalog: BuildExportCatalog,
  unresolved: UnresolvedItems,
  itemLabel: string,
): Array<V2Substat | null> {
  const width = maxSubstats(item);
  const chaosSlot = chaosSlotIndex(item);
  const positions = substats.map((stat, order) => stat.index ?? order);
  const subs: Array<V2Substat | null> = new Array(Math.max(width, ...positions.map((p) => p + 1), 0)).fill(null);
  const lastPosition = positions.at(-1) ?? -1;
  const hasChaos = chaosType !== -1 && chaosSlot >= 0 && lastPosition >= 0;

  substats.forEach((substat, order) => {
    const stat = catalog.snapshot.statTypes[substat.type];
    if (!stat) {
      unresolved.substats.push(`${itemLabel}: StatType ${substat.type}`);
      return;
    }
    const qualifier = substat.qualifier ?? "";
    const base = scaleRoll(catalog.snapshot, item, stat, qualifier, substat.roll);
    if (base === null) {
      unresolved.substats.push(`${itemLabel}: ${stat}${qualifier ? ` (${qualifier})` : ""}`);
      return;
    }
    const position = positions[order]!;
    subs[hasChaos && position === lastPosition ? chaosSlot : position] = { stat, base, q: qualifier };
  });

  return subs;
}

// ------------------------------------------------------------------ skills ----

/**
 * Skill ids resolve through `gameId` — the `SkillConfig` id the game puts on the wire. The site's
 * own key is a slug of the DISPLAY name and is not derivable from the game id
 * (`IncreasedManaRegen` -> `increased-recovery`), so this join is the only correct one.
 *
 * Anything left over is a skill the class tree does not contain — grimoire-granted skills, monster
 * skills, the auto-attack pseudo-skill — and is reported rather than written into a build the
 * planner would reject.
 */
function translateSkills(
  snapshot: CharacterSnapshot,
  classData: SnapshotClass | undefined,
  catalog: BuildExportCatalog,
  unresolved: UnresolvedItems,
): Record<string, number> {
  const routes = skillRoutes(classData, catalog);
  const skills: Record<string, number> = {};
  for (const skill of snapshot.skills) {
    if (skill.level <= 0) continue;
    const route = routes[skill.id];
    if (!route) {
      unresolved.skills.push(`${skill.displayName} (level ${skill.level})`);
      continue;
    }
    skills[route] = Math.max(skills[route] ?? 0, clampInt(skill.level, 0, 99, 0));
  }
  return skills;
}

/**
 * A character's points sit on its own tree and on the base tree it advanced from, so the lookup
 * spans both. Walking every class that lists this one as advanced covers the relationship without
 * hardcoding the advancement map.
 */
function skillRoutes(classData: SnapshotClass | undefined, catalog: BuildExportCatalog): Record<string, string> {
  const routes: Record<string, string> = {};
  const consider = (entry: SnapshotClass | undefined) => {
    for (const skill of entry?.skills ?? []) {
      if (skill.gameId && !routes[skill.gameId]) routes[skill.gameId] = skill.id;
    }
  };
  consider(classData);
  if (classData) {
    for (const entry of catalog.snapshot.classes) {
      if (entry.advancedClasses.some((slug) => slug === classData.slug || slug === classData.gameId)) consider(entry);
    }
  }
  return routes;
}

// ------------------------------------------------------- weapon swap sets ----

/** The planner models weapon swapping for Gunslinger only; slot C is the heavy-weapon set. */
const WEAPON_SET_CLASS = "Gunslinger";

/**
 * The three stored loadouts are WEAPON-swap sets, not gear sets: on a live Gunslinger the worn
 * list held all ten items while the stored loadouts held one weapon each. Mapping them to gear
 * stages invents stages containing a single weapon and no armour, so only the two weapon slots
 * are read.
 */
function translateWeaponSets(
  snapshot: CharacterSnapshot,
  cls: string,
  catalog: BuildExportCatalog,
  unresolved: UnresolvedItems,
  notes: string[],
): { wload: Array<{ mainhand: V2Equipment | null; offhand: V2Equipment | null }>; wset: number } | null {
  const loadouts = snapshot.loadouts;
  if (!loadouts?.some((set) => set.length)) return null;
  if (cls !== WEAPON_SET_CLASS) {
    notes.push("Stored weapon loadouts were ignored: the planner only models weapon swapping for Gunslinger.");
    return null;
  }

  const weapon = (set: readonly CharacterEquipment[], slot: string): V2Equipment | null => {
    const worn = set.find((entry) => entry.slot === slot);
    if (!worn) return null;
    const item = catalog.snapshot.equipment[worn.itemId];
    if (!item) {
      unresolved.equipment.push(`loadout ${slot}: ${worn.itemId}`);
      return null;
    }
    return translateEquipmentEntry(worn, item, catalog, unresolved);
  };

  const wload = [0, 1, 2].map((index) => ({
    mainhand: weapon(loadouts[index] ?? [], "Main hand"),
    offhand: weapon(loadouts[index] ?? [], "Off hand"),
  }));
  const active = ["Normal", "Secondary", "Heavy"].indexOf(snapshot.activeLoadout);
  return { wload, wset: active === -1 ? 0 : active };
}

// -------------------------------------------------------------------- misc ----

export function emptyUnresolved(): UnresolvedItems {
  return { equipment: [], cards: [], artifacts: [], gems: [], grimoires: [], skills: [], substats: [], classes: [] };
}

export function countUnresolved(unresolved: UnresolvedItems): number {
  return Object.values(unresolved).reduce((total, list) => total + list.length, 0);
}

function clampInt(value: number, minimum: number, maximum: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

export { V2_ARTIFACT_SLOTS };
