import path from "node:path";

import { normalizeUiScale, type UiScale } from "@svoverlay/desktop-platform/ui-scale";
import { resolveLocalStorageRoot } from "@svoverlay/desktop-platform/local-storage";
import { loadJsonSettings, writeJsonFileAtomic } from "@svoverlay/desktop-platform/json-settings";
import { DEFAULT_HISTORY_SESSION_LIMIT, normalizeHistorySessionLimit } from "@svoverlay/desktop-platform/session-summary-journal";

export interface LauncherSettings {
  captureAdapter: "auto" | string;
  uiScale: UiScale;
  minimizeToTray: boolean;
  resetMeterOnMapChange: boolean;
  resetGoldOnMapChange: boolean;
  pastLogLimit: number;
  skippedUpdateVersion?: string;
}

const defaults: LauncherSettings = {
  captureAdapter: "auto",
  uiScale: 1,
  minimizeToTray: false,
  resetMeterOnMapChange: true,
  resetGoldOnMapChange: false,
  pastLogLimit: DEFAULT_HISTORY_SESSION_LIMIT,
};

export function defaultLauncherSettings(): LauncherSettings {
  return { ...defaults };
}
export async function loadLauncherSettings(file = defaultSettingsFile()): Promise<LauncherSettings> {
  return loadJsonSettings(file, (value) => {
    const candidate = value as Partial<LauncherSettings>;
    return {
      captureAdapter: typeof candidate.captureAdapter === "string" && candidate.captureAdapter.trim()
        ? candidate.captureAdapter
        : defaults.captureAdapter,
      uiScale: normalizeUiScale(candidate.uiScale),
      minimizeToTray: candidate.minimizeToTray === true,
      resetMeterOnMapChange: typeof candidate.resetMeterOnMapChange === "boolean"
        ? candidate.resetMeterOnMapChange
        : defaults.resetMeterOnMapChange,
      resetGoldOnMapChange: candidate.resetGoldOnMapChange === true,
      pastLogLimit: normalizeHistorySessionLimit(candidate.pastLogLimit),
      skippedUpdateVersion: typeof candidate.skippedUpdateVersion === "string" && candidate.skippedUpdateVersion.trim()
        ? candidate.skippedUpdateVersion
        : undefined,
    };
  }, () => ({ ...defaults }));
}

export async function saveLauncherSettings(settings: LauncherSettings, file = defaultSettingsFile()): Promise<void> {
  await writeJsonFileAtomic(file, settings);
}

function defaultSettingsFile(): string {
  return path.join(resolveLocalStorageRoot(), "data", "settings", "launcher.json");
}
