import type { MessageKey } from "@svoverlay/i18n/messages";

export interface RarityTier {
  value: number;
  labelKey: MessageKey;
  color: string;
}

export const RARITY_TIERS: readonly RarityTier[] = [
  { value: 0, labelKey: "rarity.common", color: "#f2f2f2" },
  { value: 2, labelKey: "rarity.rare", color: "#2ecc71" },
  { value: 3, labelKey: "rarity.epic", color: "#a35bff" },
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

export function rarityLabelKey(rarity: number | undefined): MessageKey {
  return rarityTier(rarity).labelKey;
}

export function rarityColor(rarity: number | undefined): string {
  return rarityTier(rarity).color;
}
