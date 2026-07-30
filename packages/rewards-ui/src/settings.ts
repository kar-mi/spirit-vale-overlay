import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLocalStorageRoot } from "@spiritvale/ui-core/local-storage";
import type { WindowFrame } from "@spiritvale/ui-core/window-chrome";
import { loadJsonSettings } from "@spiritvale/ui-core/json-settings";
import type { RewardsAppView } from "./app-types.ts";

export interface RewardsAppSettings {
  frame: WindowFrame;
  catalogFrame: WindowFrame;
  pinned: boolean;
  view: RewardsAppView;
  /** All-time Character XP total, checkpointed across restarts. The rate/graph data itself stays in-memory only. */
  xpTotalExperience: number;
  /** Recorded time (ms) of the last kill counted toward xpTotalExperience — prevents a fresh log tail (e.g. after reopening this window) from double-counting kills already reflected in the checkpoint. */
  xpWatermarkMs: number;
  /** How many kills were already counted at exactly xpWatermarkMs — disambiguates a tie (e.g. an AoE clearing several mobs at once) from a duplicate replay of the same kill. */
  xpWatermarkOccurrences: number;
}

const REWARDS_APP_VIEWS: readonly RewardsAppView[] = ["summary", "recent", "trends", "xpTracker"];

const defaults: RewardsAppSettings = {
  frame: { x: 120, y: 90, width: 1020, height: 695 },
  catalogFrame: { x: 170, y: 140, width: 830, height: 745 },
  pinned: false,
  view: "summary",
  xpTotalExperience: 0,
  xpWatermarkMs: 0,
  xpWatermarkOccurrences: 0,
};
const defaultSettingsPath = path.join(resolveLocalStorageRoot(), "data", "settings", "rewards.json");

export async function loadRewardsSettings(settingsPath = defaultSettingsPath): Promise<RewardsAppSettings> {
  return loadJsonSettings(settingsPath, (candidate) => {
    const value = candidate as Partial<RewardsAppSettings>;
    return {
      frame: validFrame(value.frame) ? value.frame : defaults.frame,
      catalogFrame: validFrame(value.catalogFrame) ? value.catalogFrame : defaults.catalogFrame,
      pinned: typeof value.pinned === "boolean" ? value.pinned : defaults.pinned,
      view: value.view !== undefined && (REWARDS_APP_VIEWS as readonly string[]).includes(value.view) ? value.view : defaults.view,
      xpTotalExperience: normalizeNonNegativeNumber(value.xpTotalExperience, defaults.xpTotalExperience),
      xpWatermarkMs: normalizeNonNegativeNumber(value.xpWatermarkMs, defaults.xpWatermarkMs),
      xpWatermarkOccurrences: normalizeNonNegativeNumber(value.xpWatermarkOccurrences, defaults.xpWatermarkOccurrences),
    };
  }, () => ({ ...defaults, frame: { ...defaults.frame }, catalogFrame: { ...defaults.catalogFrame } }));
}

function normalizeNonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export async function saveRewardsSettings(settings: RewardsAppSettings, settingsPath = defaultSettingsPath): Promise<void> {
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function validFrame(value: unknown): value is RewardsAppSettings["frame"] {
  if (typeof value !== "object" || value === null) return false;
  const frame = value as Record<string, unknown>;
  return ["x", "y", "width", "height"].every((key) => typeof frame[key] === "number" && Number.isFinite(frame[key]));
}
