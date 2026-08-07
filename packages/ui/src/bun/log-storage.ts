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
 * Sums a directory tree.
 *
 * Children are totalled in parallel and then reduced, rather than each accumulating into a shared
 * counter: `total += await …` reads the counter before awaiting, so concurrent callbacks overwrite
 * each other's updates and the walk silently under-reports.
 */
async function walk(directory: string): Promise<Totals> {
  const entries = await readdir(directory, { withFileTypes: true });
  const totals = await Promise.all(entries.map(async (entry): Promise<Totals> => {
    const full = path.join(directory, entry.name);
    // Symlinks are not followed: a link out of the log directory is not the log directory's usage,
    // and a link back into it would be counted twice or loop forever.
    if (entry.isSymbolicLink()) return { bytes: 0, files: 0 };
    if (entry.isDirectory()) return walk(full);
    if (!entry.isFile()) return { bytes: 0, files: 0 };
    try {
      return { bytes: (await stat(full)).size, files: 1 };
    } catch {
      // Removed or locked between listing and stat; skipping it beats failing the whole walk.
      return { bytes: 0, files: 0 };
    }
  }));
  return totals.reduce(
    (sum, entry) => ({ bytes: sum.bytes + entry.bytes, files: sum.files + entry.files }),
    { bytes: 0, files: 0 },
  );
}
