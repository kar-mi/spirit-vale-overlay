import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/** How much disk the log directory is using, as of one measurement. */
export interface LogStorageUsage {
  bytes: number;
  files: number;
  /** When the walk ran, so the launcher can say how current the figure is. */
  measuredAt: string;
}

/**
 * Totals the log directory once.
 *
 * Measured rather than tracked: nothing prunes these logs, so the number only grows, and a figure
 * from launch is honest as long as it says when it was taken. Deliberately not refreshed on a
 * timer — a walk while capture is appending would report a number that drifts under the user for
 * no benefit.
 *
 * Resolves to undefined when the directory cannot be read; this is a status line, not a feature
 * anything depends on.
 */
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

/**
 * Entries inspected at once.
 *
 * Recursing with an unbounded `Promise.all` per directory put one `stat` in flight for roughly every
 * file in the tree, not every file in a directory: each subdirectory fanned out concurrently with
 * its siblings, so the peaks multiplied with depth. One session directory is written per capture, so
 * a long-lived install reaches thousands of simultaneous handles on the one walk this does at launch.
 */
const WALK_CONCURRENCY = 16;

/**
 * Sums a directory tree, one level at a time.
 *
 * Breadth-first rather than recursive so the concurrency limit means something: the work at each
 * level is a flat list, and no level starts before the one above it is done.
 */
async function walk(root: string): Promise<Totals> {
  const totals: Totals = { bytes: 0, files: 0 };
  let level = [root];
  while (level.length > 0) {
    const directories: string[] = [];
    const files: string[] = [];
    await forEachLimited(level, async (directory) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        // Symlinks are not followed: a link out of the log directory is not the log directory's
        // usage, and a link back into it would be counted twice or loop forever.
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) directories.push(full);
        else if (entry.isFile()) files.push(full);
      }
    });
    await forEachLimited(files, async (file) => {
      try {
        const { size } = await stat(file);
        // Read and assign after the await, never `totals.bytes += await …`: that form reads the
        // counter before suspending, so concurrent callbacks overwrite each other and the walk
        // silently under-reports.
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

/** Runs `run` over every item with at most {@link WALK_CONCURRENCY} in flight. */
async function forEachLimited<T>(items: readonly T[], run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++) await run(items[index]!);
  };
  await Promise.all(Array.from({ length: Math.min(WALK_CONCURRENCY, items.length) }, worker));
}
