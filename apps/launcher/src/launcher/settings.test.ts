import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadLauncherSettings, saveLauncherSettings } from "./settings.ts";

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
  expect(await loadLauncherSettings(settingsPath)).toEqual({ captureAdapter: "auto", language: "en", uiScale: 1, minimizeToTray: false, resetMeterOnMapChange: true, resetGoldOnMapChange: false, pastLogLimit: 100, skippedUpdateVersion: undefined });
});

test("launcher settings round-trip with capture settings", async () => {
  const settingsPath = await createSettingsPath();
  await saveLauncherSettings({ captureAdapter: "auto", language: "en", uiScale: 2, minimizeToTray: true, resetMeterOnMapChange: true, resetGoldOnMapChange: true, pastLogLimit: 500, skippedUpdateVersion: "0.6.5" }, settingsPath);
  expect(await loadLauncherSettings(settingsPath)).toEqual({ captureAdapter: "auto", language: "en", uiScale: 2, minimizeToTray: true, resetMeterOnMapChange: true, resetGoldOnMapChange: true, pastLogLimit: 500, skippedUpdateVersion: "0.6.5" });
});

test("map-change reset defaults on while preserving an explicit opt-out", async () => {
  const settingsPath = await createSettingsPath();
  await writeFile(settingsPath, JSON.stringify({ resetMeterOnMapChange: "yes" }), "utf8");
  expect((await loadLauncherSettings(settingsPath)).resetMeterOnMapChange).toBe(true);

  await writeFile(settingsPath, JSON.stringify({ resetMeterOnMapChange: false }), "utf8");
  expect((await loadLauncherSettings(settingsPath)).resetMeterOnMapChange).toBe(false);
});

test("ignores the retired close-to-tray setting", async () => {
  const settingsPath = await createSettingsPath();
  await writeFile(settingsPath, JSON.stringify({ closeToTray: true }), "utf8");
  expect(await loadLauncherSettings(settingsPath)).toEqual({ captureAdapter: "auto", language: "en", uiScale: 1, minimizeToTray: false, resetMeterOnMapChange: true, resetGoldOnMapChange: false, pastLogLimit: 100, skippedUpdateVersion: undefined });
});

test("language defaults to English and falls back for a locale this build lacks", async () => {
  const settingsPath = await createSettingsPath();
  await writeFile(settingsPath, "{}", "utf8");
  expect((await loadLauncherSettings(settingsPath)).language).toBe("en");

  await writeFile(settingsPath, JSON.stringify({ language: "xx" }), "utf8");
  expect((await loadLauncherSettings(settingsPath)).language).toBe("en");
});

test("normalizes the past log limit to a safe integer range", async () => {
  const settingsPath = await createSettingsPath();
  await writeFile(settingsPath, JSON.stringify({ pastLogLimit: 250.6 }), "utf8");
  expect((await loadLauncherSettings(settingsPath)).pastLogLimit).toBe(251);

  await writeFile(settingsPath, JSON.stringify({ pastLogLimit: 10 }), "utf8");
  expect((await loadLauncherSettings(settingsPath)).pastLogLimit).toBe(100);

  await writeFile(settingsPath, JSON.stringify({ pastLogLimit: 200_000 }), "utf8");
  expect((await loadLauncherSettings(settingsPath)).pastLogLimit).toBe(100_000);

  await writeFile(settingsPath, JSON.stringify({ pastLogLimit: "all" }), "utf8");
  expect((await loadLauncherSettings(settingsPath)).pastLogLimit).toBe(100);
});

async function createSettingsPath(): Promise<string> {
  temporaryRoot ??= await mkdtemp(path.join(tmpdir(), "spiritvale-launcher-settings-"));
  return path.join(temporaryRoot, "settings.json");
}
