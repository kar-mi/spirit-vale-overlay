const CLASS_ICON_BY_ARCHETYPE: Readonly<Record<number, string>> = {
  0: "warrior", 1: "mage", 2: "rogue", 3: "knight", 4: "summoner", 5: "acolyte", 6: "scout",
  10: "paladin", 12: "berserker", 14: "priest", 16: "wizard", 21: "shinobi", 22: "gunslinger",
  26: "necromancer", 31: "weaver",
};

const CLASS_ICON_BY_NAME: Readonly<Record<string, string>> = {
  Warrior: "warrior", Mage: "mage", Rogue: "rogue", Knight: "knight", Summoner: "summoner",
  Acolyte: "acolyte", Scout: "scout", Paladin: "paladin", Berserker: "berserker", Priest: "priest",
  Wizard: "wizard", Shinobi: "shinobi", Gunslinger: "gunslinger", Necromancer: "necromancer", Weaver: "weaver",
};

export function classIconUrl(value: number | string | undefined): string {
  const slug = typeof value === "number"
    ? CLASS_ICON_BY_ARCHETYPE[value]
    : typeof value === "string"
      ? CLASS_ICON_BY_NAME[value]
      : undefined;
  return `views://assets/class-icons/class-${slug ?? "weaver"}.webp`;
}
