import path from "node:path";
import { resolveLocalStorageRoot } from "@svoverlay/desktop-platform/local-storage";
import type { WindowFrame } from "@svoverlay/ui-kit/window-chrome";
import { loadJsonSettings, writeJsonFileAtomic } from "@svoverlay/desktop-platform/json-settings";
import { isWindowFrame } from "@svoverlay/desktop-platform/window-placement";
import type { RewardsAppView } from "./app-types.ts";

export interface RewardsAppSettings {
  frame: WindowFrame;
  catalogFrame: WindowFrame;
  pinned: boolean;
  view: RewardsAppView;
}

const REWARDS_APP_VIEWS: readonly RewardsAppView[] = ["summary", "recent", "trends", "xpTracker"];

const defaults: RewardsAppSettings = {
  frame: { x: 120, y: 90, width: 1244, height: 986 },
  catalogFrame: { x: 170, y: 140, width: 925, height: 745 },
  pinned: false,
  view: "summary",
};
const defaultSettingsPath = path.join(resolveLocalStorageRoot(), "data", "settings", "rewards.json");

export function defaultRewardsSettings(): RewardsAppSettings {
  return { ...defaults, frame: { ...defaults.frame }, catalogFrame: { ...defaults.catalogFrame } };
}

export async function loadRewardsSettings(settingsPath = defaultSettingsPath): Promise<RewardsAppSettings> {
  return loadJsonSettings(settingsPath, (candidate) => {
    const value = candidate as Partial<RewardsAppSettings>;
    return {
      frame: isWindowFrame(value.frame) ? value.frame : defaults.frame,
      catalogFrame: isWindowFrame(value.catalogFrame) ? value.catalogFrame : defaults.catalogFrame,
      pinned: typeof value.pinned === "boolean" ? value.pinned : defaults.pinned,
      view: value.view !== undefined && (REWARDS_APP_VIEWS as readonly string[]).includes(value.view) ? value.view : defaults.view,
    };
  }, () => ({ ...defaults, frame: { ...defaults.frame }, catalogFrame: { ...defaults.catalogFrame } }));
}

export async function saveRewardsSettings(settings: RewardsAppSettings, settingsPath = defaultSettingsPath): Promise<void> {
  await writeJsonFileAtomic(settingsPath, settings);
}
