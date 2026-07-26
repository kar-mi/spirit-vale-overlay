import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadLauncherSettings, saveLauncherSettings } from "./launcher-settings.ts";

let temporaryRoot: string | undefined;

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

test("launcher settings default safely and reject unsupported UI scales", async () => {
  const settingsPath = await createSettingsPath();
  await writeFile(settingsPath, JSON.stringify({ uiScale: 1.5 }), "utf8");
  expect((await loadLauncherSettings(settingsPath)).uiScale).toBe(1.5);

  await writeFile(settingsPath, JSON.stringify({ uiScale: 1.1 }), "utf8");
  expect((await loadLauncherSettings(settingsPath)).uiScale).toBe(1);
  expect((await loadLauncherSettings(settingsPath)).minimizeToTray).toBe(false);

  await writeFile(settingsPath, "{}", "utf8");
  expect(await loadLauncherSettings(settingsPath)).toEqual({ captureAdapter: "auto", uiScale: 1, minimizeToTray: false });
});

test("launcher settings round-trip with capture settings", async () => {
  const settingsPath = await createSettingsPath();
  await saveLauncherSettings({ captureAdapter: "auto", uiScale: 2, minimizeToTray: true }, settingsPath);
  expect(await loadLauncherSettings(settingsPath)).toEqual({ captureAdapter: "auto", uiScale: 2, minimizeToTray: true });
});

test("legacy close-to-tray setting migrates to minimize-to-tray", async () => {
  const settingsPath = await createSettingsPath();
  await writeFile(settingsPath, JSON.stringify({ closeToTray: true }), "utf8");
  expect(await loadLauncherSettings(settingsPath)).toEqual({ captureAdapter: "auto", uiScale: 1, minimizeToTray: true });
});

async function createSettingsPath(): Promise<string> {
  temporaryRoot ??= await mkdtemp(path.join(tmpdir(), "spiritvale-launcher-settings-"));
  return path.join(temporaryRoot, "settings.json");
}
