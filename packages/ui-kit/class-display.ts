interface GameClass {
  name: string;
  slug: string;
}

interface ClassDisplay {
  name: string;
  iconUrl?: string;
}

const CLASSES: readonly (GameClass & { archetype: number })[] = [
  { archetype: 0, name: "Warrior", slug: "warrior" },
  { archetype: 1, name: "Mage", slug: "mage" },
  { archetype: 2, name: "Rogue", slug: "rogue" },
  { archetype: 3, name: "Knight", slug: "knight" },
  { archetype: 4, name: "Summoner", slug: "summoner" },
  { archetype: 5, name: "Acolyte", slug: "acolyte" },
  { archetype: 6, name: "Scout", slug: "scout" },
  { archetype: 10, name: "Paladin", slug: "paladin" },
  { archetype: 12, name: "Berserker", slug: "berserker" },
  { archetype: 14, name: "Priest", slug: "priest" },
  { archetype: 16, name: "Wizard", slug: "wizard" },
  { archetype: 21, name: "Shinobi", slug: "shinobi" },
  { archetype: 22, name: "Gunslinger", slug: "gunslinger" },
  { archetype: 26, name: "Necromancer", slug: "necromancer" },
  { archetype: 31, name: "Weaver", slug: "weaver" },
];

const CLASS_BY_ARCHETYPE = new Map(CLASSES.map((entry) => [entry.archetype, entry]));
const CLASS_BY_NAME = new Map(CLASSES.map((entry) => [entry.name, entry]));

export function classDisplayForArchetype(archetype: number | undefined): ClassDisplay {
  const known = archetype === undefined ? undefined : CLASS_BY_ARCHETYPE.get(archetype);
  return known ? { name: known.name, iconUrl: classIconUrl(known.slug) } : { name: "Unknown" };
}

export function classIconUrlForArchetype(archetype: number | undefined): string | undefined {
  const known = CLASS_BY_ARCHETYPE.get(archetype ?? -1);
  return known ? classIconUrl(known.slug) : undefined;
}

export function classIconUrlForName(name: string): string | undefined {
  const known = CLASS_BY_NAME.get(name);
  return known ? classIconUrl(known.slug) : undefined;
}

function classIconUrl(slug: string): string {
  return `views://assets/class-icons/class-${slug}.webp`;
}
