import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeUiScale, type UiScale } from "@spiritvale/ui-core/ui-scale";
import { resolveLocalStorageRoot } from "@spiritvale/ui-core/local-storage";
import { loadJsonSettings } from "@spiritvale/ui-core/json-settings";

export interface LauncherSettings {
  captureAdapter: "auto" | string;
  uiScale: UiScale;
  minimizeToTray: boolean;
  /** Rotates the capture session whenever the game re-authenticates (a map or channel change). */
  resetMeterOnMapChange: boolean;
  skippedUpdateVersion?: string;
}

const defaults: LauncherSettings = {
  captureAdapter: "auto",
  uiScale: 1,
  minimizeToTray: false,
  resetMeterOnMapChange: false,
};
export async function loadLauncherSettings(file = defaultSettingsFile()): Promise<LauncherSettings> {
  return loadJsonSettings(file, (value) => {
    const candidate = value as Partial<LauncherSettings>;
    return {
      captureAdapter: typeof candidate.captureAdapter === "string" && candidate.captureAdapter.trim()
        ? candidate.captureAdapter
        : defaults.captureAdapter,
      uiScale: normalizeUiScale(candidate.uiScale),
      minimizeToTray: candidate.minimizeToTray === true,
      resetMeterOnMapChange: candidate.resetMeterOnMapChange === true,
      skippedUpdateVersion: typeof candidate.skippedUpdateVersion === "string" && candidate.skippedUpdateVersion.trim()
        ? candidate.skippedUpdateVersion
        : undefined,
    };
  }, () => ({ ...defaults }));
}

export async function saveLauncherSettings(settings: LauncherSettings, file = defaultSettingsFile()): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function defaultSettingsFile(): string {
  return path.join(resolveLocalStorageRoot(), "data", "settings", "launcher.json");
}
