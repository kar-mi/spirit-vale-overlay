import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CharacterViewState } from "@kar-mi/spirit-vale-tools-character";

import type { BossTimerState, OverlayControlState } from "../app-types.ts";
import { defaultOverlaySettings, type OverlaySettings } from "../settings.ts";
import { createOverlayController, type OverlayController, type OverlaySurfaceSink } from "./controller.ts";

const emptyCharacter: CharacterViewState = { stats: [], gearTotals: [], status: "waiting", statusDetail: "" };
const emptyRate = { total: 0, perSecond: 0, perHour: 0 };

let temporaryRoots: string[] = [];
let controllers: OverlayController[] = [];

afterEach(async () => {
  await Promise.all(controllers.map((controller) => controller.shutdown()));
  controllers = [];
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots = [];
});

/** Records what the controller pushes, so a test can read the last control state a surface saw. */
function recordingSurface(display: string): OverlaySurfaceSink & { control?: OverlayControlState } {
  return {
    display,
    setClickThrough: () => {},
    setVisible: () => {},
    sendControl(state) { this.control = state; },
    sendCharacter: () => {},
    sendStatuses: () => {},
    sendMeter: () => {},
    sendBossTimers: () => {},
    sendDragPreview: () => {},
    sendMinimap: () => {},
    sendLootToast: () => {},
  };
}

async function createController(settingsPath: string): Promise<OverlayController> {
  const controller = await createOverlayController({
    logDirectory: path.dirname(settingsPath),
    settingsPath,
    getCharacterState: () => emptyCharacter,
    subscribeCharacter: () => () => {},
    subscribeActiveStatuses: () => () => {},
    subscribeMinimap: () => () => {},
    subscribeLootToast: () => () => {},
    xp: {
      getSnapshot: () => ({ ...emptyRate, timeline: [] }),
      getCoinsSnapshot: () => ({ ...emptyRate }),
      reset: () => {},
      resetCoins: () => {},
      subscribe: () => () => {},
    },
    bossTimers: {
      getState: (): BossTimerState => ({ timers: [] }),
      subscribe: () => () => {},
    },
  });
  controllers.push(controller);
  return controller;
}

async function settingsFile(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "overlay-controller-"));
  temporaryRoots.push(root);
  return path.join(root, "overlay.json");
}

/** The controller's own display list, so imported element displays resolve instead of being re-homed. */
function importedSettings(controller: OverlayController, changes: Partial<OverlaySettings>): OverlaySettings {
  return { ...defaultOverlaySettings(controller.displays), ...changes };
}

describe("replaceSettings", () => {
  test("publishes the imported elements to every surface", async () => {
    const controller = await createController(await settingsFile());
    const surface = recordingSurface(controller.wantedSurfaces()[0]!);
    controller.registerSurface(surface);
    const defaults = defaultOverlaySettings(controller.displays);

    controller.replaceSettings(importedSettings(controller, {
      elements: {
        ...defaults.elements,
        partyRanking: { ...defaults.elements.partyRanking, x: 640, y: 480 },
      },
      minimapRarityFilter: 4,
    }));

    expect(surface.control?.elements.partyRanking?.x).toBe(640);
    expect(surface.control?.elements.partyRanking?.y).toBe(480);
  });

  test("keeps the current lock mode rather than adopting the imported one", async () => {
    const controller = await createController(await settingsFile());
    controller.updateLocked(true);

    controller.replaceSettings(importedSettings(controller, { locked: false }));

    expect(controller.locked).toBe(true);
  });

  test("persists the normalized result so the file matches what is now in memory", async () => {
    const file = await settingsFile();
    const controller = await createController(file);

    controller.replaceSettings(importedSettings(controller, { meterStatType: "heal", minimapEnabled: false }));
    await controller.shutdown();

    const saved = JSON.parse(await readFile(file, "utf8")) as OverlaySettings;
    expect(saved.meterStatType).toBe("heal");
    expect(saved.minimapEnabled).toBe(false);
  });
});
