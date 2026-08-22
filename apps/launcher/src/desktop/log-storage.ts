import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface LogStorageUsage {
  bytes: number;
  files: number;
  measuredAt: string;
}

export async function measureLogStorage(directory: string): Promise<LogStorageUsage | undefined> {
  try {
    const { bytes, files } = await walk(path.resolve(directory));
    return { bytes, files, measuredAt: new Date().toISOString() };
  } catch {
    return undefined;
  }
}

interface Totals {
  bytes: number;
  files: number;
}

const WALK_CONCURRENCY = 16;

async function walk(root: string): Promise<Totals> {
  const totals: Totals = { bytes: 0, files: 0 };
  let level = [root];
  while (level.length > 0) {
    const directories: string[] = [];
    const files: string[] = [];
    await forEachLimited(level, async (directory) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) directories.push(full);
        else if (entry.isFile()) files.push(full);
      }
    });
    await forEachLimited(files, async (file) => {
      try {
        // Read the size after awaiting so concurrent workers do not overwrite totals.
        const { size } = await stat(file);
        totals.bytes += size;
        totals.files += 1;
      } catch {
        // Removed or locked between listing and stat; skipping it beats failing the whole walk.
      }
    });
    level = directories;
  }
  return totals;
}

async function forEachLimited<T>(items: readonly T[], run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++) await run(items[index]!);
  };
  await Promise.all(Array.from({ length: Math.min(WALK_CONCURRENCY, items.length) }, worker));
}
