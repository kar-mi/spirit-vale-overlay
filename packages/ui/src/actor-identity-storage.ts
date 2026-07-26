import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLocalStorageRoot } from "@spiritvale/ui-core/local-storage";

const defaultFile = path.join(resolveLocalStorageRoot(), "data", "actor-identities.json");

/** How long a party member's identity is kept without being seen again before it's pruned. */
const MAX_ENTRY_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
/**
 * Upper bound on cached identities, evicting the least-recently-seen entries first. Set above
 * the game's full playerbase (~10k) so the 30-day age prune above stays the real bound on
 * growth; this only exists as a sanity backstop (~1.5MB on disk per 10k entries).
 */
const MAX_ENTRIES = 15_000;

export interface ActorIdentityCacheEntry {
  uid: string;
  displayName: string;
  archetype?: number;
  lastSeenAtMs: number;
}

export interface ActorIdentityCache {
  entries: ActorIdentityCacheEntry[];
}

interface PersistedActorIdentityCache {
  cacheVersion: 1;
  entries: ActorIdentityCacheEntry[];
}

export async function loadActorIdentityCache(file = defaultFile): Promise<ActorIdentityCache> {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (!isPersistedCache(value)) return { entries: [] };
    return { entries: value.entries.flatMap((candidate) => {
      const entry = normalizeEntry(candidate);
      return entry ? [entry] : [];
    }) };
  } catch {
    return { entries: [] };
  }
}

export async function saveActorIdentityCache(cache: ActorIdentityCache, file = defaultFile): Promise<void> {
  const safe: PersistedActorIdentityCache = {
    cacheVersion: 1,
    entries: cache.entries.map(sanitizeEntry),
  };
  const temporary = `${file}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

export function updateActorIdentityCache(
  cache: ActorIdentityCache,
  entry: ActorIdentityCacheEntry,
): ActorIdentityCache {
  const sanitized = sanitizeEntry(entry);
  const cutoffMs = sanitized.lastSeenAtMs - MAX_ENTRY_AGE_MS;
  const entries = cache.entries
    .filter(({ uid, lastSeenAtMs }) => uid !== sanitized.uid && lastSeenAtMs >= cutoffMs);
  entries.push(sanitized);
  entries.sort((left, right) => right.lastSeenAtMs - left.lastSeenAtMs);
  return { entries: entries.slice(0, MAX_ENTRIES) };
}

function sanitizeEntry(entry: ActorIdentityCacheEntry): ActorIdentityCacheEntry {
  return {
    uid: entry.uid,
    displayName: entry.displayName,
    ...(entry.archetype === undefined ? {} : { archetype: entry.archetype }),
    lastSeenAtMs: entry.lastSeenAtMs,
  };
}

function normalizeEntry(value: unknown): ActorIdentityCacheEntry | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ActorIdentityCacheEntry>;
  if (typeof candidate.uid !== "string" || candidate.uid.length === 0) return undefined;
  if (typeof candidate.displayName !== "string" || candidate.displayName.length === 0) return undefined;
  if (!Number.isFinite(candidate.lastSeenAtMs)) return undefined;
  if (candidate.archetype !== undefined && !Number.isFinite(candidate.archetype)) return undefined;
  return {
    uid: candidate.uid,
    displayName: candidate.displayName,
    ...(candidate.archetype === undefined ? {} : { archetype: candidate.archetype }),
    lastSeenAtMs: candidate.lastSeenAtMs!,
  };
}

function isPersistedCache(value: unknown): value is PersistedActorIdentityCache {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedActorIdentityCache>;
  return candidate.cacheVersion === 1 && Array.isArray(candidate.entries);
}
