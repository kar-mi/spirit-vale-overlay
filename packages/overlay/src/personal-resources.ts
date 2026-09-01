import type { CharacterRecordValues } from "@kar-mi/spirit-vale-tools-character";

import type { OverlayExperienceProgress, OverlayResource } from "./app-types.ts";

export interface PersonalResources {
  health?: OverlayResource;
  mana?: OverlayResource;
  /** Current absorb shield, when the player has one. There is no maximum on the wire. */
  shield?: number;
}

export function personalResources(records: CharacterRecordValues | undefined): PersonalResources {
  if (!records) return {};
  return {
    ...resource("health", records.currentHealth, records.maxHealth ?? records.normalizedMaxHp),
    ...resource("mana", records.currentMana, records.maxMana ?? records.normalizedMaxMp),
    ...(validCurrent(records.currentShield) && records.currentShield > 0
      ? { shield: records.currentShield }
      : {}),
  };
}

export function resourceFill(resource: OverlayResource | OverlayExperienceProgress): number {
  if ("capped" in resource && resource.capped) return 1;
  if (resource.maximum <= 0) return 0;
  return Math.max(0, Math.min(1, resource.current / resource.maximum));
}

function resource(
  key: "health" | "mana",
  current: number | undefined,
  maximum: number | undefined,
): PersonalResources {
  if (!validCurrent(current) || !validMaximum(maximum)) return {};
  return { [key]: { current, maximum } };
}

function validCurrent(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validMaximum(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
