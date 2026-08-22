export interface RarityTier {
  value: number;
  label: string;
  color: string;
}

export const RARITY_TIERS: readonly RarityTier[] = [
  { value: 0, label: "Common", color: "#f2f2f2" },
  { value: 2, label: "Rare", color: "#2ecc71" },
  { value: 3, label: "Epic", color: "#a35bff" },
];

const DEFAULT_TIER = RARITY_TIERS[0]!;

export function rarityTier(rarity: number | undefined): RarityTier {
  if (rarity === undefined) return DEFAULT_TIER;
  let match = DEFAULT_TIER;
  for (const tier of RARITY_TIERS) {
    if (tier.value <= rarity) match = tier;
  }
  return match;
}

export function rarityLabel(rarity: number | undefined): string {
  return rarityTier(rarity).label;
}

export function rarityColor(rarity: number | undefined): string {
  return rarityTier(rarity).color;
}
