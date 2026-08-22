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

function resolveOldSettingsPaths(selected: string): OldSettingsPaths {
  const nestedSettingsDirectory = path.join(selected, "settings");
  const settingsDirectory = existsSync(nestedSettingsDirectory) ? nestedSettingsDirectory : selected;
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
