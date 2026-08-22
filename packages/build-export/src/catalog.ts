
import snapshotJson from "./catalog/snapshot.json" with { type: "json" };
import type { BuildExportSnapshot, SnapshotClass } from "./snapshot-types.ts";

export * from "./snapshot-types.ts";

export const snapshot = snapshotJson as unknown as BuildExportSnapshot;

export interface BuildExportCatalog {
  snapshot: BuildExportSnapshot;
  grimoires: Set<string>;
  cards: Set<string>;
  gems: Set<string>;
  artifacts: Set<string>;
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
