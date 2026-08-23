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

export type SettingsKind = "launcher" | "overlay" | "dps" | "rewards" | "windowLayout";

export const SETTINGS_KINDS: readonly SettingsKind[] = ["launcher", "overlay", "dps", "rewards", "windowLayout"];

interface SettingsKindConfig {
  label: string;
  fileName: string;
  path(paths: DesktopStoragePaths): string;
  copy(sourcePath: string, destinationPath: string, displays: readonly OverlayDisplay[]): Promise<void>;
}

const SETTINGS_KIND_CONFIG: Record<SettingsKind, SettingsKindConfig> = {
  launcher: {
    label: "Launcher",
    fileName: "launcher.json",
    path: (paths) => paths.launcherSettingsPath,
    copy: async (source, dest) => { await saveLauncherSettings(await loadLauncherSettings(source), dest); },
  },
  overlay: {
    label: "Overlay",
    fileName: "overlay.json",
    path: (paths) => paths.overlaySettingsPath,
    copy: async (source, dest, displays) => { await saveOverlaySettings(await loadOverlaySettings(source, displays), dest); },
  },
  dps: {
    label: "Combat (DPS)",
    fileName: "dps.json",
    path: (paths) => paths.dpsSettingsPath,
    copy: async (source, dest) => { await saveDpsAppSettings(await loadDpsAppSettings(source), dest); },
  },
  rewards: {
    label: "Rewards",
    fileName: "rewards.json",
    path: (paths) => paths.rewardsSettingsPath,
    copy: async (source, dest) => { await saveRewardsSettings(await loadRewardsSettings(source), dest); },
  },
  windowLayout: {
    label: "Window Layout",
    fileName: "windows.json",
    path: (paths) => paths.windowPlacementsPath,
    copy: async (source, dest) => { await importWindowPlacements(source, dest); },
  },
};

export function settingsKindLabel(kind: SettingsKind): string {
  return SETTINGS_KIND_CONFIG[kind].label;
}

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
): Promise<void> {
  const config = SETTINGS_KIND_CONFIG[kind];
  await config.copy(sourceFilePath, config.path(currentPaths), displays);
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
): Promise<void> {
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
}

export async function importSettingsFrom(
  selectedDirectory: string,
  currentPaths: DesktopStoragePaths,
  displays: readonly OverlayDisplay[],
): Promise<ImportSettingsStatus> {
  const plan = planImport(selectedDirectory, currentPaths);
  if (plan.status !== "ready") return plan.status;
  await applyImport(plan.oldPaths, currentPaths, displays);
  return "imported";
}

export async function resetAllSettings(paths: DesktopStoragePaths, displays: readonly OverlayDisplay[]): Promise<void> {
  await saveLauncherSettings(defaultLauncherSettings(), paths.launcherSettingsPath);
  await saveOverlaySettings(defaultOverlaySettings(displays), paths.overlaySettingsPath);
  await saveDpsAppSettings(defaultDpsAppSettings(), paths.dpsSettingsPath);
  await saveRewardsSettings(defaultRewardsSettings(), paths.rewardsSettingsPath);
  await resetWindowPlacements(paths.windowPlacementsPath);
}
