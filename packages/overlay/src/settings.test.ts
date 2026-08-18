import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  defaultOverlaySettings,
  loadOverlaySettings,
  normalizeOverlaySettings,
  resetOverlayShortcuts,
  saveOverlaySettings,
} from "./settings.ts";
import { displayKey } from "./display-layout.ts";
import { requiredStatusOptions } from "./required-statuses.ts";

let temporaryRoot: string | undefined;
const displays = [{ bounds: { x: 0, y: 0, width: 1280, height: 720 }, isPrimary: true }];
const primaryKey = displayKey(displays[0]!);
const someBuffId = requiredStatusOptions("buffs")[0]!.statusId;
const someToggleId = requiredStatusOptions("toggles")[0]!.statusId;

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

describe("overlay settings", () => {
  test("defaults time-series and rolling DPS tiles to off", () => {
    const settings = defaultOverlaySettings(displays);

    expect(settings.elements.xpChart.enabled).toBe(false);
    expect(settings.elements.dpsChart.enabled).toBe(false);
    expect(settings.elements.personalDps.enabled).toBe(false);
  });

  test("uses the slim stacked XP bar layout by default", () => {
    const settings = defaultOverlaySettings([{ bounds: { x: 0, y: 0, width: 2560, height: 1440 }, isPrimary: true }]);

    expect(settings.elements.characterXp).toEqual({
      enabled: true, opacity: 1, x: 1770, y: 1090, width: 410, height: 29, display: "2560x1440@0,0",
    });
    expect(settings.elements.jobXp).toEqual({
      enabled: true, opacity: 1, x: 1770, y: 1120, width: 410, height: 30, display: "2560x1440@0,0",
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

    const settings = await loadOverlaySettings(settingsPath, displays);
    expect(settings.locked).toBe(true);
    expect(settings.shortcuts).toEqual({
      toggleLock: "Ctrl+Shift+1",
      resetSession: "Ctrl+Shift+2",
      openLiveDeathLog: "Ctrl+Shift+3",
      toggleOverlayVisible: "Ctrl+Shift+4",
      cycleMeterStatType: "Ctrl+Shift+5",
      resetXpTracker: "Ctrl+Shift+6",
      resetGoldTracker: "Ctrl+Shift+7",
    });
    expect(settings).not.toHaveProperty("personalName");
    expect(settings.elements.dpsChart).toEqual({ enabled: false, opacity: 0.55, x: 780, y: 0, width: 500, height: 200, display: primaryKey });
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
    const settings = defaultOverlaySettings(displays);
    settings.elements.partyRanking.x = 640;
    settings.elements.health.enabled = false;
    await saveOverlaySettings(settings, settingsPath);
    expect(await loadOverlaySettings(settingsPath, displays)).toEqual(settings);
  });

  test("adds default XP bars without replacing current schema-four customizations", () => {
    const settings = normalizeOverlaySettings({
      schemaVersion: 4,
      elements: {
        health: { enabled: false, x: 25, width: 325 },
        xpTracker: { enabled: false },
      },
    }, displays);

    expect(settings.elements.health).toMatchObject({ enabled: false, x: 25, width: 325 });
    expect(settings.elements.xpTracker.enabled).toBe(false);
    expect(settings.elements.characterXp).toMatchObject({ enabled: true, width: 410, height: 29 });
    expect(settings.elements.jobXp).toMatchObject({ enabled: true, width: 410, height: 30 });
  });

  test("defaults the gold tracker tile on, near the XP tracker", () => {
    const settings = defaultOverlaySettings([{ bounds: { x: 0, y: 0, width: 2560, height: 1440 }, isPrimary: true }]);

    expect(settings.elements.goldTracker.enabled).toBe(true);
    expect(settings.elements.goldTracker).toEqual({
      enabled: true, opacity: 1, x: 1720, y: 700, width: 160, height: 120, display: "2560x1440@0,0",
    });
  });

  test("allows fully transparent tiles and clamps opacity to the supported range", () => {
    const transparent = normalizeOverlaySettings({ schemaVersion: 4, elements: { dpsChart: { opacity: 0 } } }, displays);
    const outOfRange = normalizeOverlaySettings({ schemaVersion: 4, elements: {
      dpsChart: { opacity: -0.1 },
      personalDps: { opacity: 1.1 },
    } }, displays);

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
    }, displays);

    expect(settings.elements.health.height).toBe(24);
    expect(settings.elements.characterXp.height).toBe(24);
    expect(settings.elements.weight.height).toBe(40);
  });

  test("ignores retired schemas without overriding current custom heights", () => {
    const retired = normalizeOverlaySettings({
      schemaVersion: 3,
      elements: { weight: { enabled: false, height: 72 } },
    }, displays);
    const current = normalizeOverlaySettings({
      schemaVersion: 4,
      elements: { weight: { height: 72 } },
    }, displays);

    expect(retired.elements.weight).toMatchObject({ enabled: true, height: 60 });
    expect(current.elements.weight.height).toBe(72);
  });

  test("ignores the retired flat reset shortcut", async () => {
    const settingsPath = await createSettingsPath();
    const settings = normalizeOverlaySettings({ schemaVersion: 3, resetShortcut: "shift+ctrl+f8" }, displays);
    expect(settings.shortcuts.resetSession).toBe("Ctrl+Shift+2");
    await saveOverlaySettings(settings, settingsPath);
    expect((await loadOverlaySettings(settingsPath, displays)).shortcuts.resetSession).toBe("Ctrl+Shift+2");
  });

  test("ignores the retired flat overlay-visible shortcut", async () => {
    const settingsPath = await createSettingsPath();
    const settings = normalizeOverlaySettings({ schemaVersion: 3, overlayVisibleShortcut: "shift+ctrl+f8" }, displays);
    expect(settings.shortcuts.toggleOverlayVisible).toBe("Ctrl+Shift+4");
    await saveOverlaySettings(settings, settingsPath);
    expect((await loadOverlaySettings(settingsPath, displays)).shortcuts.toggleOverlayVisible).toBe("Ctrl+Shift+4");
  });

  test("uses the numbered lock shortcut by default and allows reassigning it", () => {
    const settings = normalizeOverlaySettings({ schemaVersion: 3 }, displays);
    expect(settings.shortcuts.toggleLock).toBe("Ctrl+Shift+1");
    const reassigned = normalizeOverlaySettings(
      { schemaVersion: 4, shortcuts: { toggleLock: "Ctrl+F1" } },
      displays,
    );
    expect(reassigned.shortcuts.toggleLock).toBe("Ctrl+F1");
  });

  test("reserves Escape as the always-on route out of edit mode", () => {
    const settings = normalizeOverlaySettings(
      { schemaVersion: 5, shortcuts: { toggleLock: "Escape" } },
      displays,
    );
    expect(settings.shortcuts.toggleLock).toBe("Ctrl+Shift+1");
  });

  test("falls back later shortcuts to their defaults when they collide with an earlier one", () => {
    const settings = normalizeOverlaySettings(
      { schemaVersion: 4, shortcuts: { toggleLock: "F8", resetSession: "F8", toggleOverlayVisible: "F8" } },
      displays,
    );
    expect(settings.shortcuts.toggleLock).toBe("F8");
    expect(settings.shortcuts.resetSession).toBe("Ctrl+Shift+2");
    expect(settings.shortcuts.toggleOverlayVisible).toBe("Ctrl+Shift+4");
  });

  test("uses the numbered party meter shortcut by default and allows reassigning it", () => {
    const settings = normalizeOverlaySettings({}, displays);
    expect(settings.shortcuts.cycleMeterStatType).toBe("Ctrl+Shift+5");
    const reassigned = normalizeOverlaySettings(
      { schemaVersion: 4, shortcuts: { cycleMeterStatType: "Ctrl+F7" } },
      displays,
    );
    expect(reassigned.shortcuts.cycleMeterStatType).toBe("Ctrl+F7");
  });

  test("preserves every valid saved shortcut instead of migrating old defaults", () => {
    const settings = normalizeOverlaySettings({
      schemaVersion: 5,
      shortcuts: {
        toggleLock: "F11",
        resetSession: "F5",
        openLiveDeathLog: "F6",
        toggleOverlayVisible: "F9",
        cycleMeterStatType: "F7",
        resetXpTracker: "F8",
        resetGoldTracker: "Shift+F8",
      },
    }, displays);

    expect(settings.shortcuts).toEqual({
      toggleLock: "F11",
      resetSession: "F5",
      openLiveDeathLog: "F6",
      toggleOverlayVisible: "F9",
      cycleMeterStatType: "F7",
      resetXpTracker: "F8",
      resetGoldTracker: "Shift+F8",
    });
  });

  test("resets every shortcut without changing other overlay settings", () => {
    const settings = defaultOverlaySettings(displays);
    settings.locked = true;
    settings.shortcuts = {
      toggleLock: "F11",
      resetSession: "F5",
      openLiveDeathLog: "F6",
      toggleOverlayVisible: "F9",
      cycleMeterStatType: "F7",
      resetXpTracker: "F8",
      resetGoldTracker: "Shift+F8",
    };

    const reset = resetOverlayShortcuts(settings);

    expect(reset).not.toBe(settings);
    expect(reset.locked).toBe(true);
    expect(reset.shortcuts).toEqual(defaultOverlaySettings(displays).shortcuts);
  });

  test("arms no missing-buff warning by default", () => {
    expect(defaultOverlaySettings(displays).requiredStatuses).toEqual({ buffs: [], toggles: [] });
  });

  test("defaults both focus-aware behaviors to off", () => {
    const settings = defaultOverlaySettings(displays);
    expect(settings.autoHideWhenUnfocused).toBe(false);
    expect(settings.keybindsRequireGameFocus).toBe(false);
  });

  test("normalizes focus-aware settings without replacing schema-four customizations", () => {
    const settings = normalizeOverlaySettings({
      schemaVersion: 4,
      locked: true,
      autoHideWhenUnfocused: true,
      keybindsRequireGameFocus: true,
    }, displays);

    expect(settings.locked).toBe(true);
    expect(settings.autoHideWhenUnfocused).toBe(true);
    expect(settings.keybindsRequireGameFocus).toBe(true);
    expect(normalizeOverlaySettings({
      schemaVersion: 5,
      autoHideWhenUnfocused: "yes",
      keybindsRequireGameFocus: 1,
    }, displays)).toMatchObject({ autoHideWhenUnfocused: false, keybindsRequireGameFocus: false });
  });

  test("round-trips focus-aware settings", async () => {
    const settingsPath = await createSettingsPath();
    const settings = defaultOverlaySettings(displays);
    settings.autoHideWhenUnfocused = true;
    settings.keybindsRequireGameFocus = true;
    await saveOverlaySettings(settings, settingsPath);

    expect(await loadOverlaySettings(settingsPath, displays)).toMatchObject({
      autoHideWhenUnfocused: true,
      keybindsRequireGameFocus: true,
    });
  });

  test("keeps only selectable status ids for each warning category", () => {
    const settings = normalizeOverlaySettings({
      schemaVersion: 4,
      requiredStatuses: {
        buffs: [someBuffId, someBuffId, someToggleId, "NotARealStatus", 7],
        toggles: [someToggleId],
      },
    }, displays);

    // A toggle cannot be required of the buffs tile: it never appears there, so the warning
    // could never be cleared.
    expect(settings.requiredStatuses.buffs).toEqual([someBuffId]);
    expect(settings.requiredStatuses.toggles).toEqual([someToggleId]);
  });

  test("adds the missing-buff warning field without replacing current schema-four customizations", () => {
    const settings = normalizeOverlaySettings({
      schemaVersion: 4,
      elements: { health: { enabled: false, x: 25, width: 325 } },
    }, displays);

    expect(settings.elements.health).toMatchObject({ enabled: false, x: 25, width: 325 });
    expect(settings.requiredStatuses).toEqual({ buffs: [], toggles: [] });
  });

  test("round-trips armed statuses", async () => {
    const settingsPath = await createSettingsPath();
    const settings = defaultOverlaySettings(displays);
    settings.requiredStatuses.buffs = [someBuffId];
    await saveOverlaySettings(settings, settingsPath);

    expect((await loadOverlaySettings(settingsPath, displays)).requiredStatuses)
      .toEqual({ buffs: [someBuffId], toggles: [] });
  });

  test("stamps every element with the home display when migrating from schema four", () => {
    const settings = normalizeOverlaySettings({
      schemaVersion: 4,
      elements: { health: { enabled: false, x: 25, width: 325 } },
    }, displays);

    expect(settings.schemaVersion).toBe(5);
    expect(settings.homeDisplay).toBe(primaryKey);
    expect(new Set(Object.values(settings.elements).map((element) => element.display))).toEqual(new Set([primaryKey]));
    expect(settings.elements.health).toMatchObject({ enabled: false, x: 25, width: 325 });
  });

  test("resolves an unset or unknown home display to the primary display", () => {
    expect(normalizeOverlaySettings({ schemaVersion: 5 }, displays).homeDisplay).toBe(primaryKey);
    expect(normalizeOverlaySettings({ schemaVersion: 5, homeDisplay: "800x600@9000,9000" }, displays).homeDisplay)
      .toBe(primaryKey);
  });

  test("lands defaults on a non-primary home display", () => {
    const wide = { bounds: { x: 1280, y: 0, width: 2560, height: 1440 } };
    const homeKey = displayKey(wide);

    const settings = normalizeOverlaySettings({ schemaVersion: 5, homeDisplay: homeKey }, [...displays, wide]);

    expect(settings.homeDisplay).toBe(homeKey);
    // Coordinates stay display-relative, so the wider home display no longer clamps them.
    expect(settings.elements.goldTracker).toMatchObject({ x: 1720, y: 700, display: homeKey });
  });

  test("clamps each element against its own display's bounds", () => {
    const wide = { bounds: { x: 1280, y: 0, width: 2560, height: 1440 } };
    const wideKey = displayKey(wide);

    const settings = normalizeOverlaySettings({
      schemaVersion: 5,
      elements: {
        dpsChart: { x: 2400, y: 1300, width: 462, height: 226, display: wideKey },
        personalDps: { x: 2400, y: 1300, width: 462, height: 226, display: primaryKey },
      },
    }, [...displays, wide]);

    expect(settings.elements.dpsChart).toMatchObject({ x: 2098, y: 1214, display: wideKey });
    expect(settings.elements.personalDps).toMatchObject({ x: 818, y: 494, display: primaryKey });
  });

  test("falls an element on an unplugged monitor back to the home display", () => {
    const settings = normalizeOverlaySettings({
      schemaVersion: 5,
      elements: { partyRanking: { x: 40, y: 40, display: "3840x2160@-3840,0" } },
    }, displays);

    expect(settings.elements.partyRanking).toMatchObject({ x: 40, y: 40, display: primaryKey });
  });

  test("defaults the party meter stat type to damage and normalizes invalid values", () => {
    expect(normalizeOverlaySettings({}, displays).meterStatType).toBe("damage");
    expect(normalizeOverlaySettings({ schemaVersion: 4, meterStatType: "heal" }, displays).meterStatType).toBe("heal");
    expect(normalizeOverlaySettings({ schemaVersion: 4, meterStatType: "tanked" }, displays).meterStatType).toBe("tanked");
    expect(normalizeOverlaySettings({ schemaVersion: 4, meterStatType: "not-a-real-type" }, displays).meterStatType).toBe("damage");
  });

  test("defaults the personal dps mode to encounter and normalizes invalid values", () => {
    expect(normalizeOverlaySettings({}, displays).personalDpsMode).toBe("encounter");
    expect(normalizeOverlaySettings({ schemaVersion: 5, personalDpsMode: "live" }, displays).personalDpsMode).toBe("live");
    expect(normalizeOverlaySettings({ schemaVersion: 5, personalDpsMode: "not-a-real-mode" }, displays).personalDpsMode).toBe("encounter");
  });
});

async function createSettingsPath(): Promise<string> {
  temporaryRoot ??= await mkdtemp(path.join(tmpdir(), "spiritvale-overlay-settings-"));
  return path.join(temporaryRoot, "settings.json");
}
