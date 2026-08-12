import { existsSync } from "node:fs";
import path from "node:path";

import { defaultLauncherSettings, loadLauncherSettings, saveLauncherSettings } from "../launcher/settings.ts";
import {
  defaultOverlaySettings,
  loadOverlaySettings,
  saveOverlaySettings,
  type OverlayDisplay,
} from "@svoverlay/overlay/settings";
import { defaultDpsAppSettings, loadDpsAppSettings, saveDpsAppSettings } from "@svoverlay/combat/settings";
import { defaultRewardsSettings, loadRewardsSettings, saveRewardsSettings } from "@svoverlay/rewards/settings";
import { importWindowPlacements, resetWindowPlacements } from "@svoverlay/desktop-platform/window-placement";
import type { DesktopStoragePaths } from "./portable-paths.ts";

export type ImportSettingsStatus = "same-folder" | "not-found" | "imported";

interface OldSettingsPaths {
  settingsDirectory: string;
  launcherSettingsPath: string;
  overlaySettingsPath: string;
  dpsSettingsPath: string;
  rewardsSettingsPath: string;
  windowPlacementsPath: string;
}

function resolveOldSettingsPaths(dataDirectory: string): OldSettingsPaths {
  const settingsDirectory = path.join(dataDirectory, "settings");
  return {
    settingsDirectory,
    launcherSettingsPath: path.join(settingsDirectory, "launcher.json"),
    overlaySettingsPath: path.join(settingsDirectory, "overlay.json"),
    dpsSettingsPath: path.join(settingsDirectory, "dps.json"),
    rewardsSettingsPath: path.join(settingsDirectory, "rewards.json"),
    windowPlacementsPath: path.join(settingsDirectory, "windows.json"),
  };
}

/**
 * Imports settings from another install's `data` folder into the current one. Reuses each settings
 * module's own load/save pair, which already drops fields the current schema no longer has and fills
 * in defaults for anything the old file was missing.
 */
export async function importSettingsFrom(
  selectedDataDirectory: string,
  currentPaths: DesktopStoragePaths,
  displays: readonly OverlayDisplay[],
): Promise<ImportSettingsStatus> {
  const resolvedSelected = path.resolve(selectedDataDirectory);
  const currentDataDirectory = path.resolve(path.dirname(currentPaths.launcherSettingsPath), "..");
  if (resolvedSelected.toLowerCase() === currentDataDirectory.toLowerCase()) return "same-folder";

  const oldPaths = resolveOldSettingsPaths(resolvedSelected);
  if (!existsSync(oldPaths.settingsDirectory)) return "not-found";

  if (existsSync(oldPaths.launcherSettingsPath)) {
    await saveLauncherSettings(await loadLauncherSettings(oldPaths.launcherSettingsPath), currentPaths.launcherSettingsPath);
  }
  if (existsSync(oldPaths.overlaySettingsPath)) {
    await saveOverlaySettings(
      await loadOverlaySettings(oldPaths.overlaySettingsPath, displays),
      currentPaths.overlaySettingsPath,
    );
  }
  if (existsSync(oldPaths.dpsSettingsPath)) {
    await saveDpsAppSettings(await loadDpsAppSettings(oldPaths.dpsSettingsPath), currentPaths.dpsSettingsPath);
  }
  if (existsSync(oldPaths.rewardsSettingsPath)) {
    await saveRewardsSettings(await loadRewardsSettings(oldPaths.rewardsSettingsPath), currentPaths.rewardsSettingsPath);
  }
  if (existsSync(oldPaths.windowPlacementsPath)) {
    await importWindowPlacements(oldPaths.windowPlacementsPath, currentPaths.windowPlacementsPath);
  }
  return "imported";
}

/** Overwrites every settings file with its defaults. */
export async function resetAllSettings(paths: DesktopStoragePaths, displays: readonly OverlayDisplay[]): Promise<void> {
  await saveLauncherSettings(defaultLauncherSettings(), paths.launcherSettingsPath);
  await saveOverlaySettings(defaultOverlaySettings(displays), paths.overlaySettingsPath);
  await saveDpsAppSettings(defaultDpsAppSettings(), paths.dpsSettingsPath);
  await saveRewardsSettings(defaultRewardsSettings(), paths.rewardsSettingsPath);
  await resetWindowPlacements(paths.windowPlacementsPath);
}
