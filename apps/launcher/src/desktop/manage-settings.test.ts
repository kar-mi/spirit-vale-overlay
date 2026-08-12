import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { importSettingsFrom, resetAllSettings } from "./manage-settings.ts";
import { resolveDesktopStoragePaths } from "./portable-paths.ts";
import { defaultLauncherSettings } from "../launcher/settings.ts";
import { defaultOverlaySettings } from "@svoverlay/overlay/settings";
import { defaultDpsAppSettings } from "@svoverlay/combat/settings";
import { defaultRewardsSettings } from "@svoverlay/rewards/settings";

const displays = [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, isPrimary: true }];

let temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots = [];
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "manage-settings-"));
  temporaryRoots.push(root);
  return root;
}

describe("importSettingsFrom", () => {
  test("no-ops when the selected data folder is the current one", async () => {
    const root = await createRoot();
    const currentPaths = resolveDesktopStoragePaths({ root });

    const result = await importSettingsFrom(path.join(root, "data"), currentPaths, displays);

    expect(result).toBe("same-folder");
  });

  test("reports not-found when the selected folder has no settings directory", async () => {
    const currentRoot = await createRoot();
    const oldRoot = await createRoot();
    const currentPaths = resolveDesktopStoragePaths({ root: currentRoot });

    const result = await importSettingsFrom(path.join(oldRoot, "data"), currentPaths, displays);

    expect(result).toBe("not-found");
  });

  test("imports known fields, drops stale ones, and fills in missing ones with defaults", async () => {
    const currentRoot = await createRoot();
    const oldRoot = await createRoot();
    const currentPaths = resolveDesktopStoragePaths({ root: currentRoot });
    const oldSettingsDir = path.join(oldRoot, "data", "settings");
    await mkdir(oldSettingsDir, { recursive: true });

    // captureAdapter is known; skippedUpdateVersion is missing (should default to undefined);
    // totallyMadeUpField no longer exists in the schema and must be dropped.
    await writeFile(path.join(oldSettingsDir, "launcher.json"), JSON.stringify({
      captureAdapter: "Old Adapter",
      uiScale: 1,
      minimizeToTray: true,
      resetMeterOnMapChange: true,
      resetGoldOnMapChange: false,
      totallyMadeUpField: "should be dropped",
    }), "utf8");

    const result = await importSettingsFrom(path.join(oldRoot, "data"), currentPaths, displays);
    expect(result).toBe("imported");

    const imported = JSON.parse(await readFile(currentPaths.launcherSettingsPath, "utf8"));
    expect(imported.captureAdapter).toBe("Old Adapter");
    expect(imported.minimizeToTray).toBe(true);
    expect(imported.totallyMadeUpField).toBeUndefined();
    expect(imported.skippedUpdateVersion).toBeUndefined();
  });

  test("skips a settings file that doesn't exist in the old folder", async () => {
    const currentRoot = await createRoot();
    const oldRoot = await createRoot();
    const currentPaths = resolveDesktopStoragePaths({ root: currentRoot });
    const oldSettingsDir = path.join(oldRoot, "data", "settings");
    await mkdir(oldSettingsDir, { recursive: true });
    await writeFile(path.join(oldSettingsDir, "launcher.json"), JSON.stringify(defaultLauncherSettings()), "utf8");

    const result = await importSettingsFrom(path.join(oldRoot, "data"), currentPaths, displays);

    expect(result).toBe("imported");
    await expect(readFile(currentPaths.overlaySettingsPath, "utf8")).rejects.toThrow();
  });
});

describe("resetAllSettings", () => {
  test("overwrites every settings file with its defaults", async () => {
    const root = await createRoot();
    const paths = resolveDesktopStoragePaths({ root });
    await mkdir(path.dirname(paths.launcherSettingsPath), { recursive: true });
    await writeFile(paths.launcherSettingsPath, JSON.stringify({ captureAdapter: "Custom", uiScale: 1.5 }), "utf8");

    await resetAllSettings(paths, displays);

    expect(JSON.parse(await readFile(paths.launcherSettingsPath, "utf8"))).toEqual(defaultLauncherSettings());
    expect(JSON.parse(await readFile(paths.overlaySettingsPath, "utf8"))).toEqual(defaultOverlaySettings(displays));
    expect(JSON.parse(await readFile(paths.dpsSettingsPath, "utf8"))).toEqual(defaultDpsAppSettings());
    expect(JSON.parse(await readFile(paths.rewardsSettingsPath, "utf8"))).toEqual(defaultRewardsSettings());
    expect(JSON.parse(await readFile(paths.windowPlacementsPath, "utf8"))).toEqual({ frames: {} });
  });
});
