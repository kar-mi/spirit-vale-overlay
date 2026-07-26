import type { CharacterRecordValues } from "@kar-mi/spirit-vale-tools-character";

import type { OverlayResource } from "./app-types.ts";

export interface PersonalResources {
  health?: OverlayResource;
  mana?: OverlayResource;
}

export function personalResources(records: CharacterRecordValues | undefined): PersonalResources {
  if (!records) return {};
  return {
    ...resource("health", records.currentHealth, records.maxHealth),
    ...resource("mana", records.currentMana, records.maxMana),
  };
}

export function resourceFill(resource: OverlayResource): number {
  return Math.max(0, Math.min(100, resource.current / resource.maximum * 100));
}

function resource(
  key: keyof PersonalResources,
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
