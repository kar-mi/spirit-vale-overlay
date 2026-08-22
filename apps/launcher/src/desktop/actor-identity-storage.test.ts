import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  emptyActorIdentityCache,
  loadActorIdentityCache,
  saveActorIdentityCache,
  updateActorIdentityCache,
  type ActorIdentityCache,
  type ActorIdentityCacheEntry,
} from "./actor-identity-storage.ts";

function listed(cache: ActorIdentityCache): ActorIdentityCacheEntry[] {
  return [...cache.entries.values()];
}

describe("actor identity cache storage", () => {
  test("loads an empty cache when the file is missing", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-actor-identity-missing-"));
    try {
      const restored = await loadActorIdentityCache(path.join(directory, "actor-identities.json"));
      expect(listed(restored)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("loads an empty cache when the file is corrupt", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-actor-identity-corrupt-"));
    const file = path.join(directory, "actor-identities.json");
    try {
      await Bun.write(file, "not json");
      const restored = await loadActorIdentityCache(file);
      expect(listed(restored)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("round-trips saved entries", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-actor-identity-roundtrip-"));
    const file = path.join(directory, "actor-identities.json");
    try {
      let cache = emptyActorIdentityCache();
      cache = updateActorIdentityCache(cache, {
        uid: "uid-1", displayName: "Fictional Ranger", archetype: 26, lastSeenAtMs: 1_000,
      });
      cache = updateActorIdentityCache(cache, {
        uid: "uid-2", displayName: "Fictional Scout", lastSeenAtMs: 2_000,
      });
      await saveActorIdentityCache(cache, file);

      const restored = await loadActorIdentityCache(file);
      expect(listed(restored)).toEqual([
        { uid: "uid-1", displayName: "Fictional Ranger", archetype: 26, lastSeenAtMs: 1_000 },
        { uid: "uid-2", displayName: "Fictional Scout", lastSeenAtMs: 2_000 },
      ]);

      const persisted = JSON.parse(await readFile(file, "utf8"));
      expect(persisted.cacheVersion).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("upserts by uid and refreshes lastSeenAtMs", () => {
    let cache = emptyActorIdentityCache();
    cache = updateActorIdentityCache(cache, {
      uid: "uid-1", displayName: "Fictional Ranger", archetype: 26, lastSeenAtMs: 1_000,
    });
    cache = updateActorIdentityCache(cache, {
      uid: "uid-1", displayName: "Fictional Ranger", archetype: 26, lastSeenAtMs: 5_000,
    });
    expect(listed(cache)).toEqual([{ uid: "uid-1", displayName: "Fictional Ranger", archetype: 26, lastSeenAtMs: 5_000 }]);
  });

  test("moves a re-seen identity to the most-recent end", () => {
    let cache = emptyActorIdentityCache();
    cache = updateActorIdentityCache(cache, { uid: "uid-1", displayName: "Ranger", lastSeenAtMs: 1_000 });
    cache = updateActorIdentityCache(cache, { uid: "uid-2", displayName: "Scout", lastSeenAtMs: 2_000 });
    cache = updateActorIdentityCache(cache, { uid: "uid-1", displayName: "Ranger", lastSeenAtMs: 3_000 });
    expect(listed(cache).map(({ uid }) => uid)).toEqual(["uid-2", "uid-1"]);
  });

  test("updates in place so a burst of identities stays cheap", () => {
    const cache = updateActorIdentityCache(emptyActorIdentityCache(), {
      uid: "uid-1", displayName: "Ranger", lastSeenAtMs: 1_000,
    });
    const next = updateActorIdentityCache(cache, { uid: "uid-2", displayName: "Scout", lastSeenAtMs: 2_000 });
    expect(next).toBe(cache);
    expect(listed(cache).map(({ uid }) => uid)).toEqual(["uid-1", "uid-2"]);
  });

  test("prunes entries older than 30 days relative to the newest update", () => {
    let cache = emptyActorIdentityCache();
    const now = 1_000 * 24 * 60 * 60 * 1_000;
    cache = updateActorIdentityCache(cache, { uid: "stale", displayName: "Old Timer", lastSeenAtMs: 0 });
    cache = updateActorIdentityCache(cache, { uid: "fresh", displayName: "Fictional Ranger", lastSeenAtMs: now });
    expect(listed(cache).map(({ uid }) => uid)).toEqual(["fresh"]);
  });

  test("caps the cache size, evicting the least-recently-seen entries first", () => {
    const seeded = new Map(Array.from({ length: 15_000 }, (_, index) => [
      `uid-${index}`,
      { uid: `uid-${index}`, displayName: `Player ${index}`, lastSeenAtMs: index },
    ] as const));
    const cache = updateActorIdentityCache({ entries: seeded }, {
      uid: "uid-15000", displayName: "Player 15000", lastSeenAtMs: 15_000,
    });
    expect(cache.entries.size).toBe(15_000);
    expect(cache.entries.has("uid-0")).toBe(false);
    expect(cache.entries.has("uid-15000")).toBe(true);
  });
});
