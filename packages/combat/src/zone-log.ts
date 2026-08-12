import { isLogStreamHeader, parseLogRecord } from "@kar-mi/spirit-vale-tools-logging";
import type { SpiritValeLocation } from "@svoverlay/desktop-platform/location";

export const ZONE_EVENT_SOURCE_PREFIX = "__spiritvaleZone:";
export const TOWER_FLOOR_EVENT_SOURCE_PREFIX = "__spiritvaleTowerFloor:";

/** Reads distinct zone visits in chronological order from a combat log. */
export async function readCombatLocations(filePath: string): Promise<SpiritValeLocation[]> {
  const locations: SpiritValeLocation[] = [];
  const text = await Bun.file(filePath).text();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const candidate: unknown = JSON.parse(line);
      if (isLogStreamHeader(candidate)) continue;
      const record = parseLogRecord(candidate);
      if (!record || record.type !== "combat.event") continue;
      const location = locationFromLogData(record.data);
      if (location !== undefined && !sameLocation(locations.at(-1), location)) locations.push(location);
    } catch {
      // Combat summaries already tolerate malformed lines. A bad zone marker must not hide a log.
    }
  }
  return locations;
}

export function locationFromLogData(data: Record<string, unknown>): SpiritValeLocation | undefined {
  if (data["kind"] !== "activation" || typeof data["sourceId"] !== "string") return undefined;
  const mapId = decodeIntegerSuffix(data["sourceId"], ZONE_EVENT_SOURCE_PREFIX);
  if (mapId !== undefined) return { kind: "map", mapId };
  const floor = decodeIntegerSuffix(data["sourceId"], TOWER_FLOOR_EVENT_SOURCE_PREFIX);
  return floor === undefined ? undefined : { kind: "eternalTower", floor };
}

function decodeIntegerSuffix(sourceId: string, prefix: string): number | undefined {
  if (!sourceId.startsWith(prefix)) return undefined;
  const encoded = sourceId.slice(prefix.length);
  if (!/^\d+$/.test(encoded)) return undefined;
  const value = Number(encoded);
  return Number.isSafeInteger(value) ? value : undefined;
}

function sameLocation(left: SpiritValeLocation | undefined, right: SpiritValeLocation): boolean {
  if (left === undefined || left.kind !== right.kind) return false;
  if (left.kind === "map" && right.kind === "map") return left.mapId === right.mapId;
  return left.kind === "eternalTower" && right.kind === "eternalTower" && left.floor === right.floor;
}
