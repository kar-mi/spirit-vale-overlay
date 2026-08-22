import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveLocalStorageRoot } from "@svoverlay/desktop-platform/local-storage";
import { writeJsonFileAtomic } from "@svoverlay/desktop-platform/json-settings";

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

/**
 * Identities keyed by uid, held least-recently-seen first.
 *
 * The ordering is what makes updates cheap: identities arrive in bursts — zoning into a hub can
 * produce hundreds in a second — and each one used to re-sort and re-copy the whole 15,000-entry
 * list. Re-inserting into a `Map` moves an entry to the end instead, so both the age prune and the
 * size cap only ever have to walk the stale front of the map.
 */
export interface ActorIdentityCache {
  entries: Map<string, ActorIdentityCacheEntry>;
}

interface PersistedActorIdentityCache {
  cacheVersion: 1;
  entries: ActorIdentityCacheEntry[];
}

export function emptyActorIdentityCache(): ActorIdentityCache {
  return { entries: new Map() };
}

export async function loadActorIdentityCache(file = defaultFile): Promise<ActorIdentityCache> {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (!isPersistedCache(value)) return emptyActorIdentityCache();
    const entries = new Map<string, ActorIdentityCacheEntry>();
    // Written least-recently-seen first, so inserting in file order restores that ordering.
    for (const candidate of value.entries) {
      const entry = normalizeEntry(candidate);
      if (entry) entries.set(entry.uid, entry);
    }
    return { entries };
  } catch {
    return emptyActorIdentityCache();
  }
}

export async function saveActorIdentityCache(cache: ActorIdentityCache, file = defaultFile): Promise<void> {
  const safe: PersistedActorIdentityCache = {
    cacheVersion: 1,
    entries: [...cache.entries.values()].map(sanitizeEntry),
  };
  await writeJsonFileAtomic(file, safe);
}

/**
 * Records `entry` as the most recently seen, prunes anything now too old, and evicts the least
 * recently seen if that pushes the map past {@link MAX_ENTRIES}.
 *
 * Updates the cache **in place** and returns it, so a burst of identities costs O(1) each rather
 * than copying up to {@link MAX_ENTRIES} entries per call. That is safe for the save queue this
 * feeds because the queue is told not to snapshot (`clone: false`) and `saveActorIdentityCache`
 * serialises synchronously: a later update cannot interleave with a save in progress, and one that
 * lands during the debounce simply gets included.
 */
export function updateActorIdentityCache(
  cache: ActorIdentityCache,
  entry: ActorIdentityCacheEntry,
): ActorIdentityCache {
  const sanitized = sanitizeEntry(entry);
  const { entries } = cache;
  // Delete before set so a re-seen identity moves to the most-recent end rather than staying put.
  entries.delete(sanitized.uid);
  entries.set(sanitized.uid, sanitized);

  const cutoffMs = sanitized.lastSeenAtMs - MAX_ENTRY_AGE_MS;
  for (const [uid, candidate] of entries) {
    // Ordered oldest first, so the first entry inside the window ends the sweep.
    if (candidate.lastSeenAtMs >= cutoffMs) break;
    entries.delete(uid);
  }
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (oldest.done) break;
    entries.delete(oldest.value);
  }
  return cache;
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
