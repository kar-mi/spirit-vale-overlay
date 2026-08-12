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

/**
 * A user can point the picker at either the app's `data` folder or its nested `data/settings`
 * folder directly — auto-detect which one was selected by checking for a `settings` subfolder.
 */
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

/**
 * Read-only: resolves what an import from `selectedDirectory` would do, without touching disk.
 * Callers that hold long-lived windows with their own in-memory settings (the overlay controller
 * in particular reloads only at startup and re-persists its stale copy when its window closes)
 * must close those windows before calling {@link applyImport}, or the import gets silently
 * overwritten again right after it lands. Splitting resolve from apply lets a caller do that
 * teardown only once it knows there's actually something to import.
 */
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

/**
 * Performs the writes for a `"ready"` {@link ImportPlan}. Reuses each settings module's own
 * load/save pair, which already drops fields the current schema no longer has and fills in
 * defaults for anything the old file was missing.
 */
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

/** Convenience wrapper combining {@link planImport} and {@link applyImport} in one call. */
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

/** Overwrites every settings file with its defaults. */
export async function resetAllSettings(paths: DesktopStoragePaths, displays: readonly OverlayDisplay[]): Promise<void> {
  await saveLauncherSettings(defaultLauncherSettings(), paths.launcherSettingsPath);
  await saveOverlaySettings(defaultOverlaySettings(displays), paths.overlaySettingsPath);
  await saveDpsAppSettings(defaultDpsAppSettings(), paths.dpsSettingsPath);
  await saveRewardsSettings(defaultRewardsSettings(), paths.rewardsSettingsPath);
  await resetWindowPlacements(paths.windowPlacementsPath);
}
