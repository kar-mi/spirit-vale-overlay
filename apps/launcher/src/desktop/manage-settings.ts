import { existsSync } from "node:fs";
import path from "node:path";

import { defaultLauncherSettings, loadLauncherSettings, saveLauncherSettings, type LauncherSettings } from "../launcher/settings.ts";
import {
  defaultOverlaySettings,
  loadOverlaySettings,
  saveOverlaySettings,
  type OverlayDisplay,
  type OverlaySettings,
} from "@svoverlay/overlay/settings";
import { defaultDpsAppSettings, loadDpsAppSettings, saveDpsAppSettings, type DpsAppSettings } from "@svoverlay/combat/settings";
import { defaultRewardsSettings, loadRewardsSettings, saveRewardsSettings, type RewardsAppSettings } from "@svoverlay/rewards/settings";
import { importWindowPlacements, resetWindowPlacements } from "@svoverlay/desktop-platform/window-placement";
import type { DesktopStoragePaths } from "./portable-paths.ts";

export type SettingsKind = "launcher" | "overlay" | "dps" | "rewards" | "windowLayout";

/** What an import wrote, so open windows can adopt it without re-reading the files. */
export interface ImportedSettings {
  launcher?: LauncherSettings;
  overlay?: OverlaySettings;
  dps?: DpsAppSettings;
  rewards?: RewardsAppSettings;
  windowLayout?: boolean;
}

interface SettingsKindConfig {
  fileName: string;
  path(paths: DesktopStoragePaths): string;
  copy(sourcePath: string, destinationPath: string, displays: readonly OverlayDisplay[]): Promise<ImportedSettings>;
}

const SETTINGS_KIND_CONFIG: Record<SettingsKind, SettingsKindConfig> = {
  launcher: {
    fileName: "launcher.json",
    path: (paths) => paths.launcherSettingsPath,
    copy: async (source, dest) => {
      const launcher = await loadLauncherSettings(source);
      await saveLauncherSettings(launcher, dest);
      return { launcher };
    },
  },
  overlay: {
    fileName: "overlay.json",
    path: (paths) => paths.overlaySettingsPath,
    copy: async (source, dest, displays) => {
      const overlay = await loadOverlaySettings(source, displays);
      await saveOverlaySettings(overlay, dest);
      return { overlay };
    },
  },
  dps: {
    fileName: "dps.json",
    path: (paths) => paths.dpsSettingsPath,
    copy: async (source, dest) => {
      const dps = await loadDpsAppSettings(source);
      await saveDpsAppSettings(dps, dest);
      return { dps };
    },
  },
  rewards: {
    fileName: "rewards.json",
    path: (paths) => paths.rewardsSettingsPath,
    copy: async (source, dest) => {
      const rewards = await loadRewardsSettings(source);
      await saveRewardsSettings(rewards, dest);
      return { rewards };
    },
  },
  windowLayout: {
    fileName: "windows.json",
    path: (paths) => paths.windowPlacementsPath,
    copy: async (source, dest) => {
      await importWindowPlacements(source, dest);
      return { windowLayout: true };
    },
  },
};

export function settingsKindFileName(kind: SettingsKind): string {
  return SETTINGS_KIND_CONFIG[kind].fileName;
}

export function settingsKindPath(kind: SettingsKind, paths: DesktopStoragePaths): string {
  return SETTINGS_KIND_CONFIG[kind].path(paths);
}

export async function importSingleSetting(
  kind: SettingsKind,
  sourceFilePath: string,
  currentPaths: DesktopStoragePaths,
  displays: readonly OverlayDisplay[],
): Promise<ImportedSettings> {
  const config = SETTINGS_KIND_CONFIG[kind];
  return config.copy(sourceFilePath, config.path(currentPaths), displays);
}

export async function exportSingleSetting(
  kind: SettingsKind,
  currentPaths: DesktopStoragePaths,
  destinationFilePath: string,
  displays: readonly OverlayDisplay[],
): Promise<void> {
  const config = SETTINGS_KIND_CONFIG[kind];
  await config.copy(config.path(currentPaths), destinationFilePath, displays);
}

export type ImportPlan =
  | { status: "same-folder" }
  | { status: "not-found" }
  | { status: "ready"; oldPaths: OldSettingsPaths };

export interface OldSettingsPaths {
  settingsDirectory: string;
  launcherSettingsPath: string;
  overlaySettingsPath: string;
  dpsSettingsPath: string;
  rewardsSettingsPath: string;
  windowPlacementsPath: string;
}

function resolveSettingsDirectory(selected: string): string {
  const nestedSettingsDirectory = path.join(selected, "settings");
  if (existsSync(nestedSettingsDirectory)) return nestedSettingsDirectory;
  // Covers selecting the root of a portable install, whose settings live at <root>/data/settings.
  const portableDataSettingsDirectory = path.join(selected, "data", "settings");
  if (existsSync(portableDataSettingsDirectory)) return portableDataSettingsDirectory;
  return selected;
}

function resolveOldSettingsPaths(selected: string): OldSettingsPaths {
  const settingsDirectory = resolveSettingsDirectory(selected);
  return {
    settingsDirectory,
    launcherSettingsPath: path.join(settingsDirectory, "launcher.json"),
    overlaySettingsPath: path.join(settingsDirectory, "overlay.json"),
    dpsSettingsPath: path.join(settingsDirectory, "dps.json"),
    rewardsSettingsPath: path.join(settingsDirectory, "rewards.json"),
    windowPlacementsPath: path.join(settingsDirectory, "windows.json"),
  };
}

export function planImport(selectedDirectory: string, currentPaths: DesktopStoragePaths): ImportPlan {
  const resolvedSelected = path.resolve(selectedDirectory);
  const currentSettingsDirectory = path.resolve(path.dirname(currentPaths.launcherSettingsPath));
  const currentDataDirectory = path.resolve(currentSettingsDirectory, "..");
  if (
    resolvedSelected.toLowerCase() === currentDataDirectory.toLowerCase()
    || resolvedSelected.toLowerCase() === currentSettingsDirectory.toLowerCase()
  ) {
    return { status: "same-folder" };
  }

  const oldPaths = resolveOldSettingsPaths(resolvedSelected);
  const hasAnySettingsFile = [
    oldPaths.launcherSettingsPath,
    oldPaths.overlaySettingsPath,
    oldPaths.dpsSettingsPath,
    oldPaths.rewardsSettingsPath,
    oldPaths.windowPlacementsPath,
  ].some(existsSync);
  if (!hasAnySettingsFile) return { status: "not-found" };

  return { status: "ready", oldPaths };
}

export async function applyImport(
  oldPaths: OldSettingsPaths,
  currentPaths: DesktopStoragePaths,
  displays: readonly OverlayDisplay[],
): Promise<ImportedSettings> {
  const imported: ImportedSettings = {};
  if (existsSync(oldPaths.launcherSettingsPath)) {
    imported.launcher = await loadLauncherSettings(oldPaths.launcherSettingsPath);
    await saveLauncherSettings(imported.launcher, currentPaths.launcherSettingsPath);
  }
  if (existsSync(oldPaths.overlaySettingsPath)) {
    imported.overlay = await loadOverlaySettings(oldPaths.overlaySettingsPath, displays);
    await saveOverlaySettings(imported.overlay, currentPaths.overlaySettingsPath);
  }
  if (existsSync(oldPaths.dpsSettingsPath)) {
    imported.dps = await loadDpsAppSettings(oldPaths.dpsSettingsPath);
    await saveDpsAppSettings(imported.dps, currentPaths.dpsSettingsPath);
  }
  if (existsSync(oldPaths.rewardsSettingsPath)) {
    imported.rewards = await loadRewardsSettings(oldPaths.rewardsSettingsPath);
    await saveRewardsSettings(imported.rewards, currentPaths.rewardsSettingsPath);
  }
  if (existsSync(oldPaths.windowPlacementsPath)) {
    await importWindowPlacements(oldPaths.windowPlacementsPath, currentPaths.windowPlacementsPath);
    imported.windowLayout = true;
  }
  return imported;
}

export async function resetAllSettings(
  paths: DesktopStoragePaths,
  displays: readonly OverlayDisplay[],
): Promise<ImportedSettings> {
  const launcher = defaultLauncherSettings();
  const overlay = defaultOverlaySettings(displays);
  const dps = defaultDpsAppSettings();
  const rewards = defaultRewardsSettings();
  await saveLauncherSettings(launcher, paths.launcherSettingsPath);
  await saveOverlaySettings(overlay, paths.overlaySettingsPath);
  await saveDpsAppSettings(dps, paths.dpsSettingsPath);
  await saveRewardsSettings(rewards, paths.rewardsSettingsPath);
  await resetWindowPlacements(paths.windowPlacementsPath);
  return { launcher, overlay, dps, rewards, windowLayout: true };
}
