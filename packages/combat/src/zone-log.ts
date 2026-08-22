import { isLogStreamHeader, parseLogRecord } from "@kar-mi/spirit-vale-tools-logging";
import { type SpiritValeLocation, sameSpiritValeLocation } from "@svoverlay/desktop-platform/location";

export const ZONE_EVENT_SOURCE_PREFIX = "__spiritvaleZone:";
export const TOWER_FLOOR_EVENT_SOURCE_PREFIX = "__spiritvaleTowerFloor:";
/** Sentinel suffix for `TOWER_FLOOR_EVENT_SOURCE_PREFIX` when the tower is confirmed but no floor has been announced yet. */
export const TOWER_FLOOR_UNKNOWN_SUFFIX = "unknown";

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
      if (location !== undefined && !sameSpiritValeLocation(locations.at(-1), location)) locations.push(location);
    } catch {
      // Combat summaries already tolerate malformed lines. A bad zone marker must not hide a log.
    }
  }
  return locations;
}

export function locationFromLogData(data: Record<string, unknown>): SpiritValeLocation | undefined {
  if (data["kind"] !== "activation" || typeof data["sourceId"] !== "string") return undefined;
  const sourceId = data["sourceId"];
  const mapId = decodeIntegerSuffix(sourceId, ZONE_EVENT_SOURCE_PREFIX);
  if (mapId !== undefined) return { kind: "map", mapId };
  if (sourceId === `${TOWER_FLOOR_EVENT_SOURCE_PREFIX}${TOWER_FLOOR_UNKNOWN_SUFFIX}`) return { kind: "eternalTower" };
  const floor = decodeIntegerSuffix(sourceId, TOWER_FLOOR_EVENT_SOURCE_PREFIX);
  return floor === undefined ? undefined : { kind: "eternalTower", floor };
}

function decodeIntegerSuffix(sourceId: string, prefix: string): number | undefined {
  if (!sourceId.startsWith(prefix)) return undefined;
  const encoded = sourceId.slice(prefix.length);
  if (!/^\d+$/.test(encoded)) return undefined;
  const value = Number(encoded);
  return Number.isSafeInteger(value) ? value : undefined;
}
