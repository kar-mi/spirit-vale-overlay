/**
 * Generated from the datamine's runtime Map.Id catalog.
 *
 * Keep structured locations in logs and state. This module turns them into presentation text so
 * the UI remains compatible with zones added by a later game build.
 */
import type { SpiritValeLocation } from "@svoverlay/desktop-platform/location";

const MAP_NAMES: Readonly<Record<number, string>> = {
  1: "Nevaris", 2: "Sunny Meadows 1", 3: "Sunny Meadows 2", 4: "Bunny Woods",
  5: "Nevaris Sewers", 6: "Treant Trail", 7: "Fairy Glen", 8: "Forest Field 1",
  9: "Forest Field 2", 10: "Forest Labyrinth", 11: "Forest Labyrinth", 12: "Forest Labyrinth",
  13: "Forest Labyrinth", 14: "Mystic Lake 1", 15: "Mystic Lake 2", 16: "Lake Field",
  17: "Wayfarer's Landing", 18: "Festering Woods 1", 19: "Festering Woods 2", 20: "Swamp",
  21: "Swamp Wilderness", 22: "Forgotten Depths 1", 23: "Forgotten Depths 2", 24: "Dark Forest",
  25: "Night Garden", 26: "Abyss Castle Dungeon", 27: "Abyss Castle Keep", 28: "Abyss Castle Crypt",
  29: "Abyss Castle Library", 30: "Windy Desert", 31: "Windy Desert North", 32: "Windy Desert South",
  33: "Goblin Field", 34: "Goblin Cave 1", 35: "Goblin Cave 2", 36: "Goblin Village",
  37: "Goblin Warcamp", 38: "Crystal Cave", 39: "Starfall Tundra", 40: "Sanctum of Light",
  41: "Sanctum of Light", 42: "Stormreef Isle", 43: "Turtle Nexus", 44: "Sunken Depths",
  45: "Underground Cavern", 46: "Demon's Maw", 47: "The Forge", 48: "The Echoing Spire",
  49: "The Echoing Spire", 50: "Spire Entrance", 51: "Skirmish", 52: "Arena",
  53: "Dark Fortress Lv1", 54: "Dark Fortress Lv2",
};

export function formatZone(location: SpiritValeLocation): string {
  return location.kind === "eternalTower"
    ? `Eternal Tower - Floor ${location.floor}`
    : MAP_NAMES[location.mapId] ?? `Zone ${location.mapId}`;
}

export function formatZoneSummary(locations: readonly SpiritValeLocation[]): string | undefined {
  const latest = locations.at(-1);
  if (latest === undefined) return undefined;
  const additional = locations.length - 1;
  return `${formatZone(latest)}${additional === 0 ? "" : ` +${additional}`}`;
}
