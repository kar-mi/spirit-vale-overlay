import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLocalStorageRoot } from "@svoverlay/desktop-platform/local-storage";
import { loadJsonSettings } from "@svoverlay/desktop-platform/json-settings";

export const MINIMAP_RARITY_MIN = 0;
export const MINIMAP_RARITY_MAX = 10;

export interface MinimapSettings {
  schemaVersion: 1;
  enabled: boolean;
  rarityFilter: number;
}

export function defaultMinimapSettings(): MinimapSettings {
  return { schemaVersion: 1, enabled: true, rarityFilter: MINIMAP_RARITY_MIN };
}

export function normalizeMinimapSettings(candidate: unknown): MinimapSettings {
  const source = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
  return {
    schemaVersion: 1,
    enabled: typeof source.enabled === "boolean" ? source.enabled : true,
    rarityFilter: clampRarity(source.rarityFilter),
  };
}

export async function loadMinimapSettings(settingsPath: string | undefined): Promise<MinimapSettings> {
  return loadJsonSettings(await resolveSettingsPath(settingsPath), normalizeMinimapSettings, defaultMinimapSettings);
}

export async function saveMinimapSettings(settings: MinimapSettings, settingsPath?: string): Promise<void> {
  const target = await resolveSettingsPath(settingsPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function clampRarity(value: unknown): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : MINIMAP_RARITY_MIN;
  return Math.round(Math.max(MINIMAP_RARITY_MIN, Math.min(MINIMAP_RARITY_MAX, number)));
}

async function resolveSettingsPath(settingsPath: string | undefined): Promise<string> {
  if (settingsPath) return settingsPath;
  return path.join(resolveLocalStorageRoot(), "data", "settings", "minimap.json");
}
