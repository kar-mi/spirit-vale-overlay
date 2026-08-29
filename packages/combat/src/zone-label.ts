import { resolveBundledMapName } from "@kar-mi/spirit-vale-tools-capture";
import type { SpiritValeLocation } from "@svoverlay/desktop-platform/location";

export function formatZone(location: SpiritValeLocation): string {
  if (location.kind !== "eternalTower") {
    return resolveBundledMapName(location.mapId) ?? `Zone ${location.mapId}`;
  }
  return location.floor === undefined ? "Eternal Tower" : `Eternal Tower - Floor ${location.floor}`;
}

export function formatZoneSummary(locations: readonly SpiritValeLocation[]): string | undefined {
  const latest = locations.at(-1);
  if (latest === undefined) return undefined;
  const additional = locations.length - 1;
  return `${formatZone(latest)}${additional === 0 ? "" : ` +${additional}`}`;
}
