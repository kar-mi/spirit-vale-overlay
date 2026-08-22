import type { CharacterWeight } from "@kar-mi/spirit-vale-tools-character";

const WEIGHT_CAUTION_FRACTION = 0.75;
const WEIGHT_DANGER_FRACTION = 0.9;

export type WeightWarnLevel = "caution" | "danger";

export function weightWarnLevel(weight: CharacterWeight | undefined): WeightWarnLevel | undefined {
  if (!weight || weight.maximum <= 0) return undefined;
  const fraction = weight.current / weight.maximum;
  if (fraction > WEIGHT_DANGER_FRACTION) return "danger";
  if (fraction >= WEIGHT_CAUTION_FRACTION) return "caution";
  return undefined;
}
