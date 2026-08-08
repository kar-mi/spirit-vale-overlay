/**
 * The pinned spiritvalers.com catalog snapshot, plus the lookups the translator needs.
 *
 * Regenerate with `bun run --filter @svoverlay/build-export refresh-snapshot`; see
 * `scripts/refresh-snapshot.ts` for what the file does and does not contain, and why.
 */

import snapshotJson from "./catalog/snapshot.json" with { type: "json" };
import type { BuildExportSnapshot, SnapshotClass } from "./snapshot-types.ts";

export * from "./snapshot-types.ts";

export const snapshot = snapshotJson as unknown as BuildExportSnapshot;

/**
 * Lookup structures built once. The snapshot already stores keyed data as records, so only the
 * membership lists — stored as arrays to keep the file small — need converting for `.has()`.
 */
export interface BuildExportCatalog {
  snapshot: BuildExportSnapshot;
  grimoires: Set<string>;
  cards: Set<string>;
  gems: Set<string>;
  artifacts: Set<string>;
  /** Keyed by the game's archetype name, which is what the character payload carries. */
  classesByGameId: Record<string, SnapshotClass>;
}

let cached: BuildExportCatalog | undefined;

export function buildExportCatalog(source: BuildExportSnapshot = snapshot): BuildExportCatalog {
  if (source === snapshot && cached) return cached;
  const catalog: BuildExportCatalog = {
    snapshot: source,
    grimoires: new Set(source.grimoires),
    cards: new Set(source.cards),
    gems: new Set(source.gems),
    artifacts: new Set(source.artifacts),
    classesByGameId: Object.fromEntries(source.classes.map((entry) => [entry.gameId, entry])),
  };
  if (source === snapshot) cached = catalog;
  return catalog;
}
