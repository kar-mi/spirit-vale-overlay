import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLocalStorageRoot } from "@spiritvale/ui-core/local-storage";
import { loadJsonSettings } from "@spiritvale/ui-core/json-settings";

import {
  KEYBIND_ACTIONS,
  OVERLAY_ELEMENT_IDS,
  type KeybindAction,
  type OverlayElementId,
  type OverlayElementSettings,
  type StatType,
} from "./app-types.ts";

export { KEYBIND_ACTIONS, OVERLAY_ELEMENT_IDS };
export type { KeybindAction, OverlayElementId, OverlayElementSettings };

export interface OverlaySettings {
  schemaVersion: 4;
  locked: boolean;
  shortcuts: Record<KeybindAction, string>;
  elements: Record<OverlayElementId, OverlayElementSettings>;
  meterStatType: StatType;
}

const DEFAULT_SHORTCUTS: Record<KeybindAction, string> = {
  toggleLock: "F11",
  resetSession: "F5",
  toggleOverlayVisible: "F9",
  cycleMeterStatType: "F7",
};

export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_ELEMENTS: Record<OverlayElementId, OverlayElementSettings> = {
  dpsChart: { enabled: true, opacity: 1, x: 318, y: 775, width: 462, height: 226 },
  personalDps: { enabled: true, opacity: 1, x: 794, y: 873, width: 160, height: 127 },
  partyRanking: { enabled: true, opacity: 1, x: 315, y: 434, width: 360, height: 300 },
  health: { enabled: true, opacity: 1, x: 1037, y: 921, width: 330, height: 40 },
  mana: { enabled: true, opacity: 1, x: 1377, y: 921, width: 338, height: 40 },
  weight: { enabled: true, opacity: 1, x: 794, y: 787, width: 160, height: 40 },
  buffs: { enabled: false, opacity: 1, x: 1037, y: 20, width: 330, height: 80 },
  debuffs: { enabled: false, opacity: 1, x: 1037, y: 108, width: 330, height: 80 },
  toggles: { enabled: false, opacity: 1, x: 1037, y: 196, width: 330, height: 80 },
};

export function defaultOverlaySettings(bounds: DisplayBounds): OverlaySettings {
  return normalizeOverlaySettings({}, bounds);
}

export async function loadOverlaySettings(
  settingsPath: string | undefined,
  bounds: DisplayBounds,
): Promise<OverlaySettings> {
  return loadJsonSettings(await resolveSettingsPath(settingsPath),
    (candidate) => normalizeOverlaySettings(candidate, bounds),
    () => defaultOverlaySettings(bounds));
}

export async function saveOverlaySettings(settings: OverlaySettings, settingsPath?: string): Promise<void> {
  const target = await resolveSettingsPath(settingsPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export function normalizeOverlaySettings(candidate: unknown, bounds: DisplayBounds): OverlaySettings {
  const source = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
  const legacySettings = source.schemaVersion !== 2 && source.schemaVersion !== 3 && source.schemaVersion !== 4;
  const sourceElements = source.elements && typeof source.elements === "object"
    ? source.elements as Record<string, unknown>
    : {};
  const elements = Object.fromEntries(OVERLAY_ELEMENT_IDS.map((id) => {
    const defaults = DEFAULT_ELEMENTS[id];
    const value = sourceElements[id] && typeof sourceElements[id] === "object"
      ? sourceElements[id] as Record<string, unknown>
      : {};
    const width = clampNumber(value.width, defaults.width, 160, Math.max(160, bounds.width));
    const minimumHeight = id === "health" || id === "mana" || id === "weight" || id === "buffs" || id === "debuffs" || id === "toggles" ? 40 : 100;
    const savedHeight = legacySettings && id === "weight" && value.height === 72
      ? defaults.height
      : value.height;
    const height = clampNumber(savedHeight, defaults.height, minimumHeight, Math.max(minimumHeight, bounds.height));
    return [id, {
      enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
      opacity: normalizeOpacity(value.opacity ?? source.opacity),
      x: clampNumber(value.x, defaults.x, 0, Math.max(0, bounds.width - width)),
      y: clampNumber(value.y, defaults.y, 0, Math.max(0, bounds.height - height)),
      width,
      height,
    }];
  })) as unknown as Record<OverlayElementId, OverlayElementSettings>;
  const shortcuts = normalizeShortcuts(source);
  return {
    schemaVersion: 4,
    locked: typeof source.locked === "boolean" ? source.locked : false,
    shortcuts,
    elements,
    meterStatType: normalizeMeterStatType(source.meterStatType),
  };
}

function normalizeMeterStatType(value: unknown): StatType {
  return value === "tanked" || value === "heal" ? value : "damage";
}

export function normalizeSingleShortcut(action: KeybindAction, value: unknown): string {
  return normalizeShortcut(value, DEFAULT_SHORTCUTS[action]);
}

export function normalizeShortcuts(source: Record<string, unknown>): Record<KeybindAction, string> {
  const shortcutsSource = source.shortcuts && typeof source.shortcuts === "object"
    ? source.shortcuts as Record<string, unknown>
    : {};
  // Legacy (schemaVersion <= 3) files stored resetSession/toggleOverlayVisible as flat
  // fields and never persisted toggleLock at all (it was hardcoded to F11).
  const rawByAction: Record<KeybindAction, unknown> = {
    toggleLock: shortcutsSource.toggleLock,
    resetSession: shortcutsSource.resetSession ?? source.resetShortcut,
    toggleOverlayVisible: shortcutsSource.toggleOverlayVisible ?? source.overlayVisibleShortcut,
    cycleMeterStatType: shortcutsSource.cycleMeterStatType,
  };
  const shortcuts = {} as Record<KeybindAction, string>;
  for (const action of KEYBIND_ACTIONS) {
    const normalized = normalizeShortcut(rawByAction[action], DEFAULT_SHORTCUTS[action]);
    shortcuts[action] = Object.values(shortcuts).includes(normalized) ? DEFAULT_SHORTCUTS[action] : normalized;
  }
  return shortcuts;
}

function normalizeShortcut(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const tokens = value.split("+").map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) return fallback;
  const key = tokens.at(-1)?.toUpperCase();
  if (!key || !/^(F(?:[1-9]|1[0-9]|2[0-4])|[A-Z0-9]|SPACE|ENTER|ESCAPE|TAB|BACKSPACE|DELETE|HOME|END|PAGEUP|PAGEDOWN|ARROWUP|ARROWDOWN|ARROWLEFT|ARROWRIGHT)$/.test(key)) {
    return fallback;
  }
  const modifiers = new Set(tokens.slice(0, -1).map((token) => token.toLowerCase()));
  if ([...modifiers].some((modifier) => !["ctrl", "alt", "shift", "meta"].includes(modifier))) return fallback;
  const orderedModifiers = ["ctrl", "alt", "shift", "meta"].filter((modifier) => modifiers.has(modifier));
  return [...orderedModifiers.map((modifier) => modifier[0]!.toUpperCase() + modifier.slice(1)), key].join("+");
}

function normalizeOpacity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.round(Math.max(0.2, Math.min(1, value)) * 20) / 20;
}

function clampNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.round(Math.max(minimum, Math.min(maximum, number)));
}

async function resolveSettingsPath(settingsPath: string | undefined): Promise<string> {
  if (settingsPath) return settingsPath;
  return path.join(resolveLocalStorageRoot(), "data", "settings", "overlay.json");
}
