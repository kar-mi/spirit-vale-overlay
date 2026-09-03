import path from "node:path";
import { resolveLocalStorageRoot } from "@svoverlay/desktop-platform/local-storage";
import { loadJsonSettings, writeJsonFileAtomic } from "@svoverlay/desktop-platform/json-settings";
import { isWindowFrame } from "@svoverlay/desktop-platform/window-placement";

import type { DpsAppTab, StatType } from "./app-types.ts";
import {
  DPS_WINDOW_DEFAULT_HEIGHT,
  DPS_WINDOW_DEFAULT_WIDTH,
  DPS_WINDOW_MINIMUM_HEIGHT,
  DPS_WINDOW_MINIMUM_WIDTH,
} from "./window-size.ts";

export interface DpsAppSettings {
  tab: DpsAppTab;
  statType: StatType;
  frame: { x: number; y: number; width: number; height: number };
}

const DEFAULT_SETTINGS: DpsAppSettings = {
  tab: "all",
  statType: "damage",
  frame: { x: 80, y: 80, width: DPS_WINDOW_DEFAULT_WIDTH, height: DPS_WINDOW_DEFAULT_HEIGHT },
};

export function defaultDpsAppSettings(): DpsAppSettings {
  return { ...DEFAULT_SETTINGS, frame: { ...DEFAULT_SETTINGS.frame } };
}

export async function loadDpsAppSettings(settingsPath?: string): Promise<DpsAppSettings> {
  const resolvedSettingsPath = await resolveSettingsPath(settingsPath);
  return loadJsonSettings(resolvedSettingsPath, (value) => {
    const candidate = value as Partial<DpsAppSettings>;
    return {
      tab: candidate.tab === "personal" ? "personal" : "all",
      statType: candidate.statType === "tanked" ? "tanked" : candidate.statType === "heal" ? "heal" : "damage",
      frame: validFrame(candidate.frame) ? candidate.frame : { ...DEFAULT_SETTINGS.frame },
    };
  }, () => ({ ...DEFAULT_SETTINGS, frame: { ...DEFAULT_SETTINGS.frame } }));
}

export async function saveDpsAppSettings(settings: DpsAppSettings, settingsPath?: string): Promise<void> {
  const resolvedSettingsPath = await resolveSettingsPath(settingsPath);
  await writeJsonFileAtomic(resolvedSettingsPath, settings);
}

async function resolveSettingsPath(settingsPath: string | undefined): Promise<string> {
  if (settingsPath) return settingsPath;
  return path.join(resolveLocalStorageRoot(), "data", "settings", "dps.json");
}

function validFrame(value: unknown): value is DpsAppSettings["frame"] {
  return isWindowFrame(value)
    && value.width >= DPS_WINDOW_MINIMUM_WIDTH
    && value.height >= DPS_WINDOW_MINIMUM_HEIGHT;
}
