import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveLocalStorageRoot } from "@svoverlay/desktop-platform/local-storage";
import { writeJsonFileAtomic } from "@svoverlay/desktop-platform/json-settings";

const defaultFile = path.join(resolveLocalStorageRoot(), "data", "actor-identities.json");

const MAX_ENTRY_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_ENTRIES = 15_000;

export interface ActorIdentityCacheEntry {
  uid: string;
  displayName: string;
  archetype?: number;
  lastSeenAtMs: number;
}

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
