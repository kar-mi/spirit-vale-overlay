import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadDpsAppSettings, saveDpsAppSettings } from "./settings.ts";

let temporaryRoot: string | undefined;

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

describe("DPS app settings", () => {
  test("round-trips DPS tool settings", async () => {
    const settingsPath = await createSettingsPath();
    const settings = {
      personalName: "Fictional Hero",
      tab: "personal" as const,
      frame: { x: 120, y: 140, width: 840, height: 900 },
    };

    await saveDpsAppSettings(settings, settingsPath);

    expect(await loadDpsAppSettings(settingsPath)).toEqual(settings);
  });

  test("preserves a saved frame between the minimum and default combat window sizes", async () => {
    const settingsPath = await createSettingsPath();
    const settings = {
      personalName: "",
      tab: "all" as const,
      frame: { x: 120, y: 140, width: 700, height: 600 },
    };

    await saveDpsAppSettings(settings, settingsPath);

    expect((await loadDpsAppSettings(settingsPath)).frame).toEqual(settings.frame);
  });

  test("replaces a saved undersized frame with the default combat window size", async () => {
    const settingsPath = await createSettingsPath();
    await saveDpsAppSettings({
      personalName: "",
      tab: "all",
      frame: { x: 120, y: 140, width: 619, height: 519 },
    }, settingsPath);

    expect((await loadDpsAppSettings(settingsPath)).frame).toEqual({
      x: 80,
      y: 80,
      width: 945,
      height: 800,
    });
  });
});

async function createSettingsPath(): Promise<string> {
  temporaryRoot ??= await mkdtemp(path.join(tmpdir(), "spiritvale-dps-settings-"));
  return path.join(temporaryRoot, "settings.json");
}
