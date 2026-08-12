import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadSessionSummaryCache } from "./session-summary-cache.ts";

test("invalidates numeric-only caches and persists structured locations", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-summary-cache-"));
  const cachePath = path.join(directory, "cache.json");
  const logPath = path.join(directory, "combat.jsonl");
  const fileStat = { size: 100, mtimeMs: 200 };
  try {
    await writeFile(cachePath, JSON.stringify({
      schemaVersion: 2,
      entries: {
        [path.resolve(logPath)]: { ...fileStat, recordCount: 3, summary: "legacy", zoneIds: [17] },
      },
    }));
    const cache = await loadSessionSummaryCache(cachePath);
    expect(cache.get(logPath, fileStat)).toBeUndefined();

    cache.set(logPath, fileStat, {
      recordCount: 4,
      summary: "tower",
      locations: [{ kind: "map", mapId: 17 }, { kind: "eternalTower", floor: 2 }],
    });
    await cache.save();

    const saved = JSON.parse(await readFile(cachePath, "utf8")) as {
      schemaVersion: number;
      entries: Record<string, { locations: unknown[] }>;
    };
    expect(saved.schemaVersion).toBe(3);
    expect(saved.entries[path.resolve(logPath)]?.locations).toEqual([
      { kind: "map", mapId: 17 },
      { kind: "eternalTower", floor: 2 },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
