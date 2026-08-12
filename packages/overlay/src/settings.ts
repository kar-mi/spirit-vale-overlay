import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveLocalStorageRoot } from "@svoverlay/desktop-platform/local-storage";
import { loadJsonSettings } from "@svoverlay/desktop-platform/json-settings";

import {
  KEYBIND_ACTIONS,
  OVERLAY_ELEMENT_IDS,
  type KeybindAction,
  type OverlayDisplayOption,
  type OverlayElementId,
  type OverlayElementSettings,
  type PersonalDpsMode,
  type StatType,
} from "./app-types.ts";
import {
  REQUIRED_STATUS_CATEGORIES,
  normalizeRequiredStatusIds,
  type RequiredStatusCategory,
} from "./required-statuses.ts";
import {
  displayKey,
  resolveElementDisplay,
  resolveElementDisplayKey,
  resolveHomeDisplayKey,
  type DisplayBounds,
  type OverlayDisplay,
} from "./display-layout.ts";

export { KEYBIND_ACTIONS, OVERLAY_ELEMENT_IDS };
export type { KeybindAction, OverlayElementId, OverlayElementSettings, PersonalDpsMode };
export type { DisplayBounds, OverlayDisplay };

export interface OverlaySettings {
  schemaVersion: 5;
  /**
   * Where new tiles land and where a tile whose monitor was unplugged falls back to. Empty means
   * "use the primary display", which is also what an unrecognised key resolves to.
   */
  homeDisplay: string;
  locked: boolean;
  shortcuts: Record<KeybindAction, string>;
  elements: Record<OverlayElementId, OverlayElementSettings>;
  meterStatType: StatType;
  /** Whether the personal tile shows the whole-encounter average or the live recent-rate estimate. */
  personalDpsMode: PersonalDpsMode;
  /** Statuses the user expects to keep up; the matching tile is highlighted while any is missing. */
  requiredStatuses: Record<RequiredStatusCategory, string[]>;
}

const DEFAULT_SHORTCUTS: Record<KeybindAction, string> = {
  toggleLock: "F11",
  resetSession: "F5",
  openLiveDeathLog: "F6",
  toggleOverlayVisible: "F9",
  cycleMeterStatType: "F7",
};

/** Positions assume a ~1920x1200 display; they are clamped into whatever the home display really is. */
const DEFAULT_ELEMENTS: Record<OverlayElementId, Omit<OverlayElementSettings, "display">> = {
  dpsChart: { enabled: false, opacity: 1, x: 860, y: 20, width: 462, height: 226 },
  personalDps: { enabled: false, opacity: 1, x: 862, y: 242, width: 161, height: 135 },
  partyRanking: { enabled: true, opacity: 1, x: 730, y: 540, width: 290, height: 610 },
  health: { enabled: true, opacity: 1, x: 1040, y: 910, width: 380, height: 50 },
  mana: { enabled: true, opacity: 1, x: 1430, y: 910, width: 280, height: 50 },
  characterXp: { enabled: true, opacity: 1, x: 1770, y: 1090, width: 410, height: 29 },
  jobXp: { enabled: true, opacity: 1, x: 1770, y: 1120, width: 410, height: 30 },
  weight: { enabled: true, opacity: 1, x: 1720, y: 970, width: 160, height: 60 },
  xpTracker: { enabled: true, opacity: 1, x: 1720, y: 840, width: 160, height: 120 },
  goldTracker: { enabled: true, opacity: 1, x: 1720, y: 700, width: 160, height: 120 },
  xpChart: { enabled: false, opacity: 1, x: 1040, y: 60, width: 420, height: 300 },
  buffs: { enabled: false, opacity: 1, x: 1040, y: 830, width: 380, height: 70 },
  debuffs: { enabled: false, opacity: 1, x: 1040, y: 760, width: 380, height: 60 },
  toggles: { enabled: false, opacity: 1, x: 1430, y: 840, width: 280, height: 60 },
};

export function defaultOverlaySettings(displays: readonly OverlayDisplay[]): OverlaySettings {
  return normalizeOverlaySettings({ schemaVersion: 5 }, displays);
}

export async function loadOverlaySettings(
  settingsPath: string | undefined,
  displays: readonly OverlayDisplay[],
): Promise<OverlaySettings> {
  return loadJsonSettings(await resolveSettingsPath(settingsPath),
    (candidate) => normalizeOverlaySettings(candidate, displays),
    () => defaultOverlaySettings(displays));
}

export async function saveOverlaySettings(settings: OverlaySettings, settingsPath?: string): Promise<void> {
  const target = await resolveSettingsPath(settingsPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

/**
 * Schema four is accepted as a migration source: it carried no per-element display, so every
 * element is stamped with the resolved home display on the way through.
 */
export function normalizeOverlaySettings(
  candidate: unknown,
  displays: readonly OverlayDisplay[],
): OverlaySettings {
  const parsed = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
  const source = parsed.schemaVersion === 4 || parsed.schemaVersion === 5 ? parsed : {};
  const homeDisplay = resolveHomeDisplayKey(
    displays,
    typeof source.homeDisplay === "string" ? source.homeDisplay : "",
  );
  const fallbackBounds = displays[0]?.bounds ?? { x: 0, y: 0, width: 0, height: 0 };
  const sourceElements = source.elements && typeof source.elements === "object"
    ? source.elements as Record<string, unknown>
    : {};
  const elements = Object.fromEntries(OVERLAY_ELEMENT_IDS.map((id) => {
    const defaults = DEFAULT_ELEMENTS[id];
    const value = sourceElements[id] && typeof sourceElements[id] === "object"
      ? sourceElements[id] as Record<string, unknown>
      : {};
    const assigned = typeof value.display === "string" ? value.display : "";
    // An element on an unplugged monitor falls back to home rather than disappearing, and is
    // then clamped into whatever that display's bounds are.
    const display = resolveElementDisplayKey(displays, assigned, homeDisplay);
    const bounds = resolveElementDisplay(displays, assigned, homeDisplay)?.bounds ?? fallbackBounds;
    const width = clampNumber(value.width, defaults.width, 160, Math.max(160, bounds.width));
    const minimumHeight = id === "health" || id === "mana" || id === "characterXp" || id === "jobXp"
      ? 24
      : id === "weight" || id === "buffs" || id === "debuffs" || id === "toggles" ? 40 : 100;
    const height = clampNumber(value.height, defaults.height, minimumHeight, Math.max(minimumHeight, bounds.height));
    return [id, {
      enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
      opacity: normalizeOpacity(value.opacity),
      x: clampNumber(value.x, defaults.x, 0, Math.max(0, bounds.width - width)),
      y: clampNumber(value.y, defaults.y, 0, Math.max(0, bounds.height - height)),
      width,
      height,
      display,
    }];
  })) as unknown as Record<OverlayElementId, OverlayElementSettings>;
  const shortcuts = normalizeShortcuts(source);
  return {
    schemaVersion: 5,
    homeDisplay,
    locked: typeof source.locked === "boolean" ? source.locked : false,
    shortcuts,
    elements,
    meterStatType: normalizeMeterStatType(source.meterStatType),
    personalDpsMode: normalizePersonalDpsMode(source.personalDpsMode),
    requiredStatuses: normalizeRequiredStatuses(source.requiredStatuses),
  };
}

/** Human-readable choices for the Settings window's display pickers. */
export function overlayDisplayOptions(displays: readonly OverlayDisplay[]): OverlayDisplayOption[] {
  return displays.map((display, index) => ({
    key: displayKey(display),
    label: `Display ${index + 1} — ${Math.round(display.bounds.width)}×${Math.round(display.bounds.height)}`
      + (display.isPrimary ? " (primary)" : ""),
    primary: display.isPrimary === true,
  }));
}

function normalizeRequiredStatuses(value: unknown): Record<RequiredStatusCategory, string[]> {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(REQUIRED_STATUS_CATEGORIES.map(
    (category) => [category, normalizeRequiredStatusIds(category, source[category])],
  )) as Record<RequiredStatusCategory, string[]>;
}

function normalizeMeterStatType(value: unknown): StatType {
  return value === "tanked" || value === "heal" ? value : "damage";
}

function normalizePersonalDpsMode(value: unknown): PersonalDpsMode {
  return value === "live" ? value : "encounter";
}

export function normalizeSingleShortcut(action: KeybindAction, value: unknown): string {
  return normalizeShortcut(value, DEFAULT_SHORTCUTS[action]);
}

export function normalizeShortcuts(source: Record<string, unknown>): Record<KeybindAction, string> {
  const shortcutsSource = source.shortcuts && typeof source.shortcuts === "object"
    ? source.shortcuts as Record<string, unknown>
    : {};
  const rawByAction: Record<KeybindAction, unknown> = {
    toggleLock: shortcutsSource.toggleLock,
    resetSession: shortcutsSource.resetSession,
    openLiveDeathLog: shortcutsSource.openLiveDeathLog,
    toggleOverlayVisible: shortcutsSource.toggleOverlayVisible,
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
  // Plain Escape is the always-on route out of edit mode. Keep it
  // reserved so a configurable action can never prevent that recovery shortcut.
  if (!key || key === "ESCAPE" || !/^(F(?:[1-9]|1[0-9]|2[0-4])|[A-Z0-9]|SPACE|ENTER|TAB|BACKSPACE|DELETE|HOME|END|PAGEUP|PAGEDOWN|ARROWUP|ARROWDOWN|ARROWLEFT|ARROWRIGHT)$/.test(key)) {
    return fallback;
  }
  const modifiers = new Set(tokens.slice(0, -1).map((token) => token.toLowerCase()));
  if ([...modifiers].some((modifier) => !["ctrl", "alt", "shift", "meta"].includes(modifier))) return fallback;
  const orderedModifiers = ["ctrl", "alt", "shift", "meta"].filter((modifier) => modifiers.has(modifier));
  return [...orderedModifiers.map((modifier) => modifier[0]!.toUpperCase() + modifier.slice(1)), key].join("+");
}

function normalizeOpacity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.round(Math.max(0, Math.min(1, value)) * 20) / 20;
}

function clampNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.round(Math.max(minimum, Math.min(maximum, number)));
}

async function resolveSettingsPath(settingsPath: string | undefined): Promise<string> {
  if (settingsPath) return settingsPath;
  return path.join(resolveLocalStorageRoot(), "data", "settings", "overlay.json");
}
