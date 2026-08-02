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
import { requiredStatusOptions } from "./required-statuses.ts";

let temporaryRoot: string | undefined;
const bounds = { x: 0, y: 0, width: 1280, height: 720 };
const someBuffId = requiredStatusOptions("buffs")[0]!.statusId;
const someToggleId = requiredStatusOptions("toggles")[0]!.statusId;

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

describe("overlay settings", () => {
  test("defaults time-series and rolling DPS tiles to off", () => {
    const settings = defaultOverlaySettings(bounds);

    expect(settings.elements.xpChart.enabled).toBe(false);
    expect(settings.elements.dpsChart.enabled).toBe(false);
    expect(settings.elements.personalDps.enabled).toBe(false);
  });

  test("uses the slim stacked XP bar layout by default", () => {
    const settings = defaultOverlaySettings({ x: 0, y: 0, width: 2560, height: 1440 });

    expect(settings.elements.characterXp).toEqual({
      enabled: true, opacity: 1, x: 1770, y: 1090, width: 410, height: 29,
    });
    expect(settings.elements.jobXp).toEqual({
      enabled: true, opacity: 1, x: 1770, y: 1120, width: 410, height: 30,
    });
  });

  test("normalizes values and clamps elements to the display", async () => {
    const settingsPath = await createSettingsPath();
    await writeFile(settingsPath, JSON.stringify({
      schemaVersion: 4,
      locked: true,
      personalName: "  Fictional Hero  ",
      elements: {
        dpsChart: { enabled: false, opacity: 0.53, x: 5000, y: -50, width: 500, height: 200 },
        personalDps: { x: Number.NaN, width: 10, height: 10 },
      },
    }), "utf8");

    const settings = await loadOverlaySettings(settingsPath, bounds);
    expect(settings.locked).toBe(true);
    expect(settings.shortcuts.toggleLock).toBe("F11");
    expect(settings.shortcuts.resetSession).toBe("F5");
    expect(settings.shortcuts.openLiveDeathLog).toBe("F6");
    expect(settings.shortcuts.toggleOverlayVisible).toBe("F9");
    expect(settings).not.toHaveProperty("personalName");
    expect(settings.elements.dpsChart).toEqual({ enabled: false, opacity: 0.55, x: 780, y: 0, width: 500, height: 200 });
    expect(settings.elements.health.opacity).toBe(1);
    expect(settings.elements.personalDps.width).toBe(160);
    expect(settings.elements.personalDps.height).toBe(100);
    expect(settings.elements.health.enabled).toBe(true);
    expect(settings.elements.health.height).toBe(50);
    expect(settings.elements.mana.enabled).toBe(true);
    expect(settings.elements.mana.height).toBe(50);
    expect(settings.elements.characterXp).toMatchObject({ enabled: true, width: 410, height: 29 });
    expect(settings.elements.jobXp).toMatchObject({ enabled: true, width: 410, height: 30 });
    expect(settings.elements.weight.enabled).toBe(true);
    expect(settings.elements.weight.height).toBe(60);
  });

  test("round-trips normalized settings", async () => {
    const settingsPath = await createSettingsPath();
    const settings = defaultOverlaySettings(bounds);
    settings.elements.partyRanking.x = 640;
    settings.elements.health.enabled = false;
    await saveOverlaySettings(settings, settingsPath);
    expect(await loadOverlaySettings(settingsPath, bounds)).toEqual(settings);
  });

  test("adds default XP bars without replacing current schema-four customizations", () => {
    const settings = normalizeOverlaySettings({
      schemaVersion: 4,
      elements: {
        health: { enabled: false, x: 25, width: 325 },
        xpTracker: { enabled: false },
      },
    }, bounds);

    expect(settings.elements.health).toMatchObject({ enabled: false, x: 25, width: 325 });
    expect(settings.elements.xpTracker.enabled).toBe(false);
    expect(settings.elements.characterXp).toMatchObject({ enabled: true, width: 410, height: 29 });
    expect(settings.elements.jobXp).toMatchObject({ enabled: true, width: 410, height: 30 });
  });

  test("allows fully transparent tiles and clamps opacity to the supported range", () => {
    const transparent = normalizeOverlaySettings({ schemaVersion: 4, elements: { dpsChart: { opacity: 0 } } }, bounds);
    const outOfRange = normalizeOverlaySettings({ schemaVersion: 4, elements: {
      dpsChart: { opacity: -0.1 },
      personalDps: { opacity: 1.1 },
    } }, bounds);

    expect(transparent.elements.dpsChart.opacity).toBe(0);
    expect(outOfRange.elements.dpsChart.opacity).toBe(0);
    expect(outOfRange.elements.personalDps.opacity).toBe(1);
  });

  test("allows resource bars to be thinner than other compact elements", () => {
    const settings = normalizeOverlaySettings({
      schemaVersion: 4,
      elements: {
        health: { height: 1 },
        characterXp: { height: 1 },
        weight: { height: 1 },
      },
    }, bounds);

    expect(settings.elements.health.height).toBe(24);
    expect(settings.elements.characterXp.height).toBe(24);
    expect(settings.elements.weight.height).toBe(40);
  });

  test("ignores retired schemas without overriding current custom heights", () => {
    const retired = normalizeOverlaySettings({
      schemaVersion: 3,
      elements: { weight: { enabled: false, height: 72 } },
    }, bounds);
    const current = normalizeOverlaySettings({
      schemaVersion: 4,
      elements: { weight: { height: 72 } },
    }, bounds);

    expect(retired.elements.weight).toMatchObject({ enabled: true, height: 60 });
    expect(current.elements.weight.height).toBe(72);
  });

  test("ignores the retired flat reset shortcut", async () => {
    const settingsPath = await createSettingsPath();
    const settings = normalizeOverlaySettings({ schemaVersion: 3, resetShortcut: "shift+ctrl+f8" }, bounds);
    expect(settings.shortcuts.resetSession).toBe("F5");
    await saveOverlaySettings(settings, settingsPath);
    expect((await loadOverlaySettings(settingsPath, bounds)).shortcuts.resetSession).toBe("F5");
  });

  test("ignores the retired flat overlay-visible shortcut", async () => {
    const settingsPath = await createSettingsPath();
    const settings = normalizeOverlaySettings({ schemaVersion: 3, overlayVisibleShortcut: "shift+ctrl+f8" }, bounds);
    expect(settings.shortcuts.toggleOverlayVisible).toBe("F9");
    await saveOverlaySettings(settings, settingsPath);
    expect((await loadOverlaySettings(settingsPath, bounds)).shortcuts.toggleOverlayVisible).toBe("F9");
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

  test("arms no missing-buff warning by default", () => {
    expect(defaultOverlaySettings(bounds).requiredStatuses).toEqual({ buffs: [], toggles: [] });
  });

  test("keeps only selectable status ids for each warning category", () => {
    const settings = normalizeOverlaySettings({
      schemaVersion: 4,
      requiredStatuses: {
        buffs: [someBuffId, someBuffId, someToggleId, "NotARealStatus", 7],
        toggles: [someToggleId],
      },
    }, bounds);

    // A toggle cannot be required of the buffs tile: it never appears there, so the warning
    // could never be cleared.
    expect(settings.requiredStatuses.buffs).toEqual([someBuffId]);
    expect(settings.requiredStatuses.toggles).toEqual([someToggleId]);
  });

  test("adds the missing-buff warning field without replacing current schema-four customizations", () => {
    const settings = normalizeOverlaySettings({
      schemaVersion: 4,
      elements: { health: { enabled: false, x: 25, width: 325 } },
    }, bounds);

    expect(settings.elements.health).toMatchObject({ enabled: false, x: 25, width: 325 });
    expect(settings.requiredStatuses).toEqual({ buffs: [], toggles: [] });
  });

  test("round-trips armed statuses", async () => {
    const settingsPath = await createSettingsPath();
    const settings = defaultOverlaySettings(bounds);
    settings.requiredStatuses.buffs = [someBuffId];
    await saveOverlaySettings(settings, settingsPath);

    expect((await loadOverlaySettings(settingsPath, bounds)).requiredStatuses)
      .toEqual({ buffs: [someBuffId], toggles: [] });
  });

  test("defaults the party meter stat type to damage and normalizes invalid values", () => {
    expect(normalizeOverlaySettings({}, bounds).meterStatType).toBe("damage");
    expect(normalizeOverlaySettings({ schemaVersion: 4, meterStatType: "heal" }, bounds).meterStatType).toBe("heal");
    expect(normalizeOverlaySettings({ schemaVersion: 4, meterStatType: "tanked" }, bounds).meterStatType).toBe("tanked");
    expect(normalizeOverlaySettings({ schemaVersion: 4, meterStatType: "not-a-real-type" }, bounds).meterStatType).toBe("damage");
  });
});

async function createSettingsPath(): Promise<string> {
  temporaryRoot ??= await mkdtemp(path.join(tmpdir(), "spiritvale-overlay-settings-"));
  return path.join(temporaryRoot, "settings.json");
}
