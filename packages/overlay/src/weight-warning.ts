import type { CharacterWeight } from "@kar-mi/spirit-vale-tools-character";

/** Share of maximum carry weight at which the weight tile starts warning. */
const WEIGHT_CAUTION_FRACTION = 0.75;
/** Share of maximum carry weight past which the warning escalates to the flashing ring. */
const WEIGHT_DANGER_FRACTION = 0.9;

export type WeightWarnLevel = "caution" | "danger";

/**
 * How urgently the weight tile should warn, if at all.
 *
 * Going over maximum weight is debilitating in game, so the tile escalates on the way there:
 * a steady caution ring from 75% of maximum, and a flashing danger ring above 90%.
 */
export function weightWarnLevel(weight: CharacterWeight | undefined): WeightWarnLevel | undefined {
  if (!weight || weight.maximum <= 0) return undefined;
  const fraction = weight.current / weight.maximum;
  if (fraction > WEIGHT_DANGER_FRACTION) return "danger";
  if (fraction >= WEIGHT_CAUTION_FRACTION) return "caution";
  return undefined;
}
