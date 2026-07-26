import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  loadActorIdentityCache,
  saveActorIdentityCache,
  updateActorIdentityCache,
  type ActorIdentityCache,
} from "./actor-identity-storage.ts";

describe("actor identity cache storage", () => {
  test("loads an empty cache when the file is missing", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-actor-identity-missing-"));
    try {
      const restored = await loadActorIdentityCache(path.join(directory, "actor-identities.json"));
      expect(restored).toEqual({ entries: [] });
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
      expect(restored).toEqual({ entries: [] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("round-trips saved entries", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-actor-identity-roundtrip-"));
    const file = path.join(directory, "actor-identities.json");
    try {
      let cache: ActorIdentityCache = { entries: [] };
      cache = updateActorIdentityCache(cache, {
        uid: "uid-1", displayName: "Yuna", archetype: 26, lastSeenAtMs: 1_000,
      });
      cache = updateActorIdentityCache(cache, {
        uid: "uid-2", displayName: "Josh", lastSeenAtMs: 2_000,
      });
      await saveActorIdentityCache(cache, file);

      const restored = await loadActorIdentityCache(file);
      expect(restored.entries.sort((left, right) => left.uid.localeCompare(right.uid))).toEqual([
        { uid: "uid-1", displayName: "Yuna", archetype: 26, lastSeenAtMs: 1_000 },
        { uid: "uid-2", displayName: "Josh", lastSeenAtMs: 2_000 },
      ]);

      const persisted = JSON.parse(await readFile(file, "utf8"));
      expect(persisted.cacheVersion).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("upserts by uid and refreshes lastSeenAtMs", () => {
    let cache: ActorIdentityCache = { entries: [] };
    cache = updateActorIdentityCache(cache, {
      uid: "uid-1", displayName: "Yuna", archetype: 26, lastSeenAtMs: 1_000,
    });
    cache = updateActorIdentityCache(cache, {
      uid: "uid-1", displayName: "Yuna", archetype: 26, lastSeenAtMs: 5_000,
    });
    expect(cache.entries).toEqual([{ uid: "uid-1", displayName: "Yuna", archetype: 26, lastSeenAtMs: 5_000 }]);
  });

  test("prunes entries older than 30 days relative to the newest update", () => {
    let cache: ActorIdentityCache = { entries: [] };
    const now = 1_000 * 24 * 60 * 60 * 1_000;
    cache = updateActorIdentityCache(cache, { uid: "stale", displayName: "Old Timer", lastSeenAtMs: 0 });
    cache = updateActorIdentityCache(cache, { uid: "fresh", displayName: "Yuna", lastSeenAtMs: now });
    expect(cache.entries.map(({ uid }) => uid)).toEqual(["fresh"]);
  });

  test("caps the cache size, evicting the least-recently-seen entries first", () => {
    // Seed 15,000 entries directly (avoiding 15,000 O(n log n) updateActorIdentityCache calls)
    // and exercise the eviction path with a single insert that pushes the cache over the cap.
    const seeded = Array.from({ length: 15_000 }, (_, index) => ({
      uid: `uid-${index}`,
      displayName: `Player ${index}`,
      lastSeenAtMs: index,
    }));
    const cache = updateActorIdentityCache({ entries: seeded }, {
      uid: "uid-15000", displayName: "Player 15000", lastSeenAtMs: 15_000,
    });
    expect(cache.entries.length).toBe(15_000);
    expect(cache.entries.some(({ uid }) => uid === "uid-0")).toBe(false);
    expect(cache.entries.some(({ uid }) => uid === "uid-15000")).toBe(true);
  });
});
