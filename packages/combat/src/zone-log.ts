import { isLogStreamHeader, parseLogRecord } from "@kar-mi/spirit-vale-tools-logging";

export const ZONE_EVENT_SOURCE_PREFIX = "__spiritvaleZone:";

/** Reads distinct zone visits in chronological order from a combat log. */
export async function readCombatZoneIds(filePath: string): Promise<number[]> {
  const zones: number[] = [];
  const text = await Bun.file(filePath).text();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const candidate: unknown = JSON.parse(line);
      if (isLogStreamHeader(candidate)) continue;
      const record = parseLogRecord(candidate);
      if (!record || record.type !== "combat.event") continue;
      const zoneId = zoneIdFromLogData(record.data);
      if (zoneId !== undefined && zones.at(-1) !== zoneId) zones.push(zoneId);
    } catch {
      // Combat summaries already tolerate malformed lines. A bad zone marker must not hide a log.
    }
  }
  return zones;
}

export function zoneIdFromLogData(data: Record<string, unknown>): number | undefined {
  if (data["kind"] !== "activation" || typeof data["sourceId"] !== "string") return undefined;
  const encoded = data["sourceId"].slice(ZONE_EVENT_SOURCE_PREFIX.length);
  if (!data["sourceId"].startsWith(ZONE_EVENT_SOURCE_PREFIX) || !/^\d+$/.test(encoded)) return undefined;
  const mapId = Number(encoded);
  return Number.isSafeInteger(mapId) ? mapId : undefined;
}
