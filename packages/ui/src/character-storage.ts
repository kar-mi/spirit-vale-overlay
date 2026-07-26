import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLocalStorageRoot } from "@spiritvale/ui-core/local-storage";
import { CURRENT_GAME_BUILD_FINGERPRINT } from "@kar-mi/spirit-vale-tools-capture";
import type { CharacterSnapshot } from "@kar-mi/spirit-vale-tools-character";

const defaultFile = path.join(resolveLocalStorageRoot(), "data", "character.json");

export interface CharacterSnapshotCache {
  activeName?: string;
  characters: CharacterSnapshot[];
}

interface PersistedCharacterSnapshotCache {
  cacheVersion: 1;
  activeName?: string;
  characters: CharacterSnapshot[];
}

export async function loadCharacterCache(file = defaultFile): Promise<CharacterSnapshotCache> {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (isPersistedCache(value)) {
      const characters = value.characters.flatMap((candidate) => {
        const snapshot = normalizeSnapshot(candidate);
        return snapshot ? [snapshot] : [];
      });
      const activeName = characters.some(({ name }) => name === value.activeName)
        ? value.activeName
        : characters.at(-1)?.name;
      return { characters, ...(activeName === undefined ? {} : { activeName }) };
    }

    // Migrate the previous single-snapshot format in memory; the next save writes the cache.
    const snapshot = normalizeSnapshot(value);
    return snapshot ? { activeName: snapshot.name, characters: [snapshot] } : { characters: [] };
  } catch {
    return { characters: [] };
  }
}

export function activeCharacterSnapshot(cache: CharacterSnapshotCache): CharacterSnapshot | undefined {
  const active = cache.activeName === undefined
    ? cache.characters.at(-1)
    : cache.characters.find(({ name }) => name === cache.activeName);
  return active ? structuredClone(active) : undefined;
}

export function updateCharacterCache(
  cache: CharacterSnapshotCache,
  snapshot: CharacterSnapshot,
): CharacterSnapshotCache {
  const cached = sanitizeSnapshot(snapshot);
  return {
    activeName: cached.name,
    characters: [...cache.characters.filter(({ name }) => name !== cached.name), cached],
  };
}

export async function saveCharacterCache(cache: CharacterSnapshotCache, file = defaultFile): Promise<void> {
  const characters = cache.characters.map(sanitizeSnapshot);
  const activeName = characters.some(({ name }) => name === cache.activeName)
    ? cache.activeName
    : characters.at(-1)?.name;
  const safe: PersistedCharacterSnapshotCache = {
    cacheVersion: 1,
    ...(activeName === undefined ? {} : { activeName }),
    characters,
  };
  const temporary = `${file}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

function sanitizeSnapshot(snapshot: CharacterSnapshot): CharacterSnapshot {
  const safe: CharacterSnapshot = {
    schemaVersion: 1,
    buildFingerprint: snapshot.buildFingerprint,
    name: snapshot.name,
    ...(snapshot.title ? { title: snapshot.title } : {}),
    archetypes: [...snapshot.archetypes],
    level: snapshot.level,
    experience: snapshot.experience,
    jobLevel: snapshot.jobLevel,
    jobExperience: snapshot.jobExperience,
    attributes: { ...snapshot.attributes },
    activeLoadout: snapshot.activeLoadout,
    equipment: structuredClone(snapshot.equipment),
    artifacts: structuredClone(snapshot.artifacts),
    skills: structuredClone(snapshot.skills),
    ...(snapshot.playtimeSeconds === undefined ? {} : { playtimeSeconds: snapshot.playtimeSeconds }),
    ...(snapshot.monsterKills === undefined ? {} : { monsterKills: snapshot.monsterKills }),
    ...(snapshot.bossKills === undefined ? {} : { bossKills: snapshot.bossKills }),
    ...(snapshot.deaths === undefined ? {} : { deaths: snapshot.deaths }),
    updatedAt: snapshot.updatedAt,
    source: "cached",
  };
  return safe;
}

function normalizeSnapshot(value: unknown): CharacterSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<CharacterSnapshot>;
  if (candidate.schemaVersion !== 1 || candidate.buildFingerprint !== CURRENT_GAME_BUILD_FINGERPRINT) return undefined;
  if (typeof candidate.name !== "string"
    || typeof candidate.level !== "number"
    || !Array.isArray(candidate.archetypes)
    || !candidate.archetypes.every((entry) => typeof entry === "string")
    || !validAttributes(candidate.attributes)) return undefined;
  return {
    ...candidate,
    activeLoadout: candidate.activeLoadout ?? "Normal",
    equipment: Array.isArray(candidate.equipment) ? candidate.equipment : [],
    artifacts: Array.isArray(candidate.artifacts) ? candidate.artifacts.map((artifact) => ({
      ...(artifact as unknown as Record<string, unknown>),
      gems: Array.isArray((artifact as { gems?: unknown }).gems)
        ? (artifact as { gems: unknown[] }).gems.flatMap((gem) => typeof gem === "string" ? [{ id: gem, refine: 0 }] : gem && typeof gem === "object" && typeof (gem as { id?: unknown }).id === "string" && typeof (gem as { refine?: unknown }).refine === "number" ? [gem] : [])
        : [],
    })) as CharacterSnapshot["artifacts"] : [],
    skills: Array.isArray(candidate.skills) ? candidate.skills.map((skill) => ({
      ...(skill as unknown as Record<string, unknown>),
      effects: Array.isArray((skill as unknown as { effects?: unknown }).effects) ? (skill as unknown as { effects: unknown[] }).effects : [],
    })) as CharacterSnapshot["skills"] : [],
    source: "cached",
  } as CharacterSnapshot;
}

function isPersistedCache(value: unknown): value is PersistedCharacterSnapshotCache {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedCharacterSnapshotCache>;
  return candidate.cacheVersion === 1
    && Array.isArray(candidate.characters)
    && (candidate.activeName === undefined || typeof candidate.activeName === "string");
}

function validAttributes(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return ["STR", "VIT", "AGI", "DEX", "INT", "LUK"].every((key) => Number.isFinite((value as Record<string, unknown>)[key]));
}
