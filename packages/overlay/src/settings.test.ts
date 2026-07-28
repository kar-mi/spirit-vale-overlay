import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  defaultOverlaySettings,
  loadOverlaySettings,
  normalizeOverlaySettings,
  saveOverlaySettings,
} from "./settings.ts";

let temporaryRoot: string | undefined;
const bounds = { x: 0, y: 0, width: 1280, height: 720 };

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

describe("overlay settings", () => {
  test("normalizes values and clamps elements to the display", async () => {
    const settingsPath = await createSettingsPath();
    await writeFile(settingsPath, JSON.stringify({
      locked: true,
      opacity: 0.53,
      personalName: "  Fictional Hero  ",
      elements: {
        dpsChart: { enabled: false, x: 5000, y: -50, width: 500, height: 200 },
        personalDps: { x: Number.NaN, width: 10, height: 10 },
      },
    }), "utf8");

    const settings = await loadOverlaySettings(settingsPath, bounds);
    expect(settings.locked).toBe(true);
    expect(settings.shortcuts.toggleLock).toBe("F11");
    expect(settings.shortcuts.resetSession).toBe("F5");
    expect(settings.shortcuts.toggleOverlayVisible).toBe("F9");
    expect(Object.values(settings.elements).every((element) => element.opacity === 0.55)).toBe(true);
    expect(settings).not.toHaveProperty("personalName");
    expect(settings.elements.dpsChart).toEqual({ enabled: false, opacity: 0.55, x: 780, y: 0, width: 500, height: 200 });
    expect(settings.elements.personalDps.width).toBe(160);
    expect(settings.elements.personalDps.height).toBe(100);
    expect(settings.elements.health.enabled).toBe(true);
    expect(settings.elements.health.height).toBe(40);
    expect(settings.elements.mana.enabled).toBe(true);
    expect(settings.elements.mana.height).toBe(40);
    expect(settings.elements.weight.enabled).toBe(true);
    expect(settings.elements.weight.height).toBe(40);
  });

  test("round-trips normalized settings", async () => {
    const settingsPath = await createSettingsPath();
    const settings = defaultOverlaySettings(bounds);
    settings.elements.partyRanking.x = 640;
    settings.elements.health.enabled = false;
    await saveOverlaySettings(settings, settingsPath);
    expect(await loadOverlaySettings(settingsPath, bounds)).toEqual(settings);
  });

  test("compacts the legacy weight default without overriding current custom heights", () => {
    const legacy = normalizeOverlaySettings({
      elements: { weight: { height: 72 } },
    }, bounds);
    const current = normalizeOverlaySettings({
      schemaVersion: 2,
      elements: { weight: { height: 72 } },
    }, bounds);

    expect(legacy.elements.weight.height).toBe(40);
    expect(current.elements.weight.height).toBe(72);
  });

  test("normalizes and persists the reset shortcut", async () => {
    const settingsPath = await createSettingsPath();
    const settings = normalizeOverlaySettings({ schemaVersion: 3, resetShortcut: "shift+ctrl+f8" }, bounds);
    expect(settings.shortcuts.resetSession).toBe("Ctrl+Shift+F8");
    await saveOverlaySettings(settings, settingsPath);
    expect((await loadOverlaySettings(settingsPath, bounds)).shortcuts.resetSession).toBe("Ctrl+Shift+F8");
  });

  test("normalizes and persists the overlay visible shortcut", async () => {
    const settingsPath = await createSettingsPath();
    const settings = normalizeOverlaySettings({ schemaVersion: 3, overlayVisibleShortcut: "shift+ctrl+f8" }, bounds);
    expect(settings.shortcuts.toggleOverlayVisible).toBe("Ctrl+Shift+F8");
    await saveOverlaySettings(settings, settingsPath);
    expect((await loadOverlaySettings(settingsPath, bounds)).shortcuts.toggleOverlayVisible).toBe("Ctrl+Shift+F8");
  });

  test("defaults the lock shortcut to F11 and allows reassigning it", () => {
    const settings = normalizeOverlaySettings({ schemaVersion: 3 }, bounds);
    expect(settings.shortcuts.toggleLock).toBe("F11");
    const reassigned = normalizeOverlaySettings(
      { schemaVersion: 4, shortcuts: { toggleLock: "Ctrl+F1" } },
      bounds,
    );
    expect(reassigned.shortcuts.toggleLock).toBe("Ctrl+F1");
  });

  test("falls back later shortcuts to their defaults when they collide with an earlier one", () => {
    const settings = normalizeOverlaySettings(
      { schemaVersion: 4, shortcuts: { toggleLock: "F8", resetSession: "F8", toggleOverlayVisible: "F8" } },
      bounds,
    );
    expect(settings.shortcuts.toggleLock).toBe("F8");
    expect(settings.shortcuts.resetSession).toBe("F5");
    expect(settings.shortcuts.toggleOverlayVisible).toBe("F9");
  });

  test("defaults the party meter cycle shortcut to F7 and allows reassigning it", () => {
    const settings = normalizeOverlaySettings({}, bounds);
    expect(settings.shortcuts.cycleMeterStatType).toBe("F7");
    const reassigned = normalizeOverlaySettings(
      { schemaVersion: 4, shortcuts: { cycleMeterStatType: "Ctrl+F7" } },
      bounds,
    );
    expect(reassigned.shortcuts.cycleMeterStatType).toBe("Ctrl+F7");
  });

  test("defaults the party meter stat type to damage and normalizes invalid values", () => {
    expect(normalizeOverlaySettings({}, bounds).meterStatType).toBe("damage");
    expect(normalizeOverlaySettings({ meterStatType: "heal" }, bounds).meterStatType).toBe("heal");
    expect(normalizeOverlaySettings({ meterStatType: "tanked" }, bounds).meterStatType).toBe("tanked");
    expect(normalizeOverlaySettings({ meterStatType: "not-a-real-type" }, bounds).meterStatType).toBe("damage");
  });
});

async function createSettingsPath(): Promise<string> {
  temporaryRoot ??= await mkdtemp(path.join(tmpdir(), "spiritvale-overlay-settings-"));
  return path.join(temporaryRoot, "settings.json");
}
