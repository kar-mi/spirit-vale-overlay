import path from "node:path";
import { resolveLocalStorageRoot } from "@svoverlay/desktop-platform/local-storage";
import { loadJsonSettings, writeJsonFileAtomic } from "@svoverlay/desktop-platform/json-settings";

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
  constrainRectToBounds,
  displayKey,
  resolveElementDisplay,
  resolveElementDisplayKey,
  resolveHomeDisplayKey,
  type DisplayBounds,
  type OverlayDisplay,
} from "./display-layout.ts";
import { RARITY_TIERS } from "./rarity.ts";

export { KEYBIND_ACTIONS, OVERLAY_ELEMENT_IDS };
export type { KeybindAction, OverlayElementId, OverlayElementSettings, PersonalDpsMode };
export type { DisplayBounds, OverlayDisplay };

export interface OverlaySettings {
  schemaVersion: 7;
  homeDisplay: string;
  locked: boolean;
  shortcuts: Record<KeybindAction, string>;
  elements: Record<OverlayElementId, OverlayElementSettings>;
  meterStatType: StatType;
  personalDpsMode: PersonalDpsMode;
  requiredStatuses: Record<RequiredStatusCategory, string[]>;
  autoHideWhenUnfocused: boolean;
  minimapEnabled: boolean;
  minimapRarityFilter: number;
  minimapLootChanceFilter: number;
}

const DEFAULT_SHORTCUTS: Record<KeybindAction, string> = {
  toggleLock: "Ctrl+Shift+1",
  resetSession: "Ctrl+Shift+2",
  openLiveDeathLog: "Ctrl+Shift+3",
  toggleOverlayVisible: "Ctrl+Shift+4",
  cycleMeterStatType: "Ctrl+Shift+5",
  resetXpTracker: "Ctrl+Shift+6",
  resetGoldTracker: "Ctrl+Shift+7",
  toggleMinimap: "TAB",
  cycleBossRegion: "Ctrl+Shift+8",
};

const DEFAULT_LOCKED = true;
const DEFAULT_AUTO_HIDE_WHEN_UNFOCUSED = true;
const DEFAULT_MINIMAP_ENABLED = false;

const DEFAULT_ELEMENTS: Record<OverlayElementId, Omit<OverlayElementSettings, "display">> = {
  dpsChart: { enabled: false, opacity: 1, x: 453, y: 342, width: 286, height: 203 },
  personalDps: { enabled: false, opacity: 1, x: 452, y: 310, width: 120, height: 95 },
  partyRanking: { enabled: true, opacity: 0.4, x: 1235, y: 341, width: 251, height: 425 },
  health: { enabled: true, opacity: 0.75, x: 570, y: 675, width: 233, height: 38 },
  mana: { enabled: true, opacity: 0.8, x: 803, y: 675, width: 278, height: 38 },
  characterXp: { enabled: false, opacity: 1, x: 435, y: 662, width: 125, height: 18 },
  jobXp: { enabled: false, opacity: 1, x: 435, y: 691, width: 128, height: 18 },
  weight: { enabled: true, opacity: 0.75, x: 1080, y: 638, width: 135, height: 38 },
  xpTracker: { enabled: false, opacity: 1, x: 452, y: 243, width: 120, height: 90 },
  goldTracker: { enabled: false, opacity: 1, x: 452, y: 276, width: 120, height: 90 },
  xpChart: { enabled: false, opacity: 1, x: 454, y: 374, width: 315, height: 225 },
  buffs: { enabled: true, opacity: 1, x: 570, y: 638, width: 233, height: 38 },
  debuffs: { enabled: false, opacity: 1, x: 455, y: 406, width: 331, height: 60 },
  toggles: { enabled: true, opacity: 1, x: 803, y: 638, width: 278, height: 38 },
  lootToast: { enabled: false, opacity: 0, x: 579, y: 247, width: 143, height: 150 },
  minimap: { enabled: false, opacity: 0, x: 707, y: 247, width: 245, height: 242 },
  bossTimers: { enabled: false, opacity: 1, x: 1140, y: 225, width: 173, height: 113 },
};

// DEFAULT_ELEMENTS is authored for a 1920x1080 display; default positions are scaled relative
// to this reference center so they stay on-screen (and roughly centered) at other resolutions.
const REFERENCE_WIDTH = 1920;
const REFERENCE_HEIGHT = 1080;
const REFERENCE_CENTER = { x: REFERENCE_WIDTH / 2, y: REFERENCE_HEIGHT / 2 };

function resolveDefaultPosition(
  defaults: Omit<OverlayElementSettings, "display">,
  bounds: DisplayBounds,
): { x: number; y: number } {
  if (bounds.width <= 0 || bounds.height <= 0) return { x: defaults.x, y: defaults.y };
  const scale = Math.min(bounds.width / REFERENCE_WIDTH, bounds.height / REFERENCE_HEIGHT);
  const x = bounds.width / 2 + (defaults.x - REFERENCE_CENTER.x) * scale;
  const y = bounds.height / 2 + (defaults.y - REFERENCE_CENTER.y) * scale;
  return { x: Math.round(x), y: Math.round(y) };
}

export function defaultOverlaySettings(displays: readonly OverlayDisplay[]): OverlaySettings {
  return normalizeOverlaySettings({ schemaVersion: 7 }, displays);
}

export function resetOverlayShortcuts(settings: OverlaySettings): OverlaySettings {
  return { ...settings, shortcuts: { ...DEFAULT_SHORTCUTS } };
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
  await writeJsonFileAtomic(target, settings);
}

export function normalizeOverlaySettings(
  candidate: unknown,
  displays: readonly OverlayDisplay[],
): OverlaySettings {
  const parsed = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
  const source = parsed.schemaVersion === 4 || parsed.schemaVersion === 5 || parsed.schemaVersion === 6 || parsed.schemaVersion === 7
    ? parsed
    : {};
  const homeDisplay = resolveHomeDisplayKey(
    displays,
    typeof source.homeDisplay === "string" ? source.homeDisplay : "",
  );
  const fallbackBounds = displays[0]?.bounds ?? { x: 0, y: 0, width: 0, height: 0 };
  const sourceElements = source.elements && typeof source.elements === "object"
    ? source.elements as Record<string, unknown>
    : {};
  const minimapEnabled = resolveMinimapEnabled(source.minimapEnabled, sourceElements.minimap);
  const elements = Object.fromEntries(OVERLAY_ELEMENT_IDS.map((id) => {
    const defaults = DEFAULT_ELEMENTS[id];
    const value = sourceElements[id] && typeof sourceElements[id] === "object"
      ? sourceElements[id] as Record<string, unknown>
      : {};
    const assigned = typeof value.display === "string" ? value.display : "";
    const display = resolveElementDisplayKey(displays, assigned, homeDisplay);
    const bounds = resolveElementDisplay(displays, assigned, homeDisplay)?.bounds ?? fallbackBounds;
    const width = clampNumber(value.width, defaults.width, 160, Math.max(160, bounds.width));
    const minimumHeight = id === "health" || id === "mana" || id === "characterXp" || id === "jobXp"
      ? 24
      : id === "weight" || id === "buffs" || id === "debuffs" || id === "toggles" || id === "bossTimers" ? 40 : 100;
    const height = clampNumber(value.height, defaults.height, minimumHeight, Math.max(minimumHeight, bounds.height));
    const defaultPosition = resolveDefaultPosition(defaults, bounds);
    const constrained = constrainRectToBounds({
      x: clampNumber(value.x, defaultPosition.x, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
      y: clampNumber(value.y, defaultPosition.y, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
      width,
      height,
    }, { x: 0, y: 0, width: bounds.width, height: bounds.height });
    const enabled = typeof value.enabled === "boolean" ? value.enabled : defaults.enabled;
    return [id, {
      enabled: id === "minimap" ? minimapEnabled && enabled : enabled,
      opacity: normalizeOpacity(value.opacity, defaults.opacity),
      x: constrained.x,
      y: constrained.y,
      width,
      height,
      display,
    }];
  })) as unknown as Record<OverlayElementId, OverlayElementSettings>;
  const shortcuts = normalizeShortcuts(source);
  return {
    schemaVersion: 7,
    homeDisplay,
    locked: typeof source.locked === "boolean" ? source.locked : DEFAULT_LOCKED,
    shortcuts,
    elements,
    meterStatType: normalizeMeterStatType(source.meterStatType),
    personalDpsMode: normalizePersonalDpsMode(source.personalDpsMode),
    requiredStatuses: normalizeRequiredStatuses(source.requiredStatuses),
    autoHideWhenUnfocused: typeof source.autoHideWhenUnfocused === "boolean"
      ? source.autoHideWhenUnfocused
      : DEFAULT_AUTO_HIDE_WHEN_UNFOCUSED,
    minimapEnabled,
    minimapRarityFilter: normalizeRarityFilter(source.minimapRarityFilter),
    minimapLootChanceFilter: normalizeLootChanceFilter(source.minimapLootChanceFilter),
  };
}

// Profiles written before the master toggle existed carry the feature state on the tile itself.
function resolveMinimapEnabled(value: unknown, storedElement: unknown): boolean {
  if (typeof value === "boolean") return value;
  const element = storedElement && typeof storedElement === "object"
    ? storedElement as Record<string, unknown>
    : {};
  return typeof element.enabled === "boolean" ? element.enabled : DEFAULT_MINIMAP_ENABLED;
}

const DEFAULT_RARITY_FILTER = 2;
function normalizeRarityFilter(value: unknown): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_RARITY_FILTER;
  let closest = RARITY_TIERS[0]!.value;
  let closestDistance = Infinity;
  for (const tier of RARITY_TIERS) {
    const distance = Math.abs(tier.value - number);
    if (distance < closestDistance) {
      closest = tier.value;
      closestDistance = distance;
    }
  }
  return closest;
}

const DEFAULT_LOOT_CHANCE_FILTER = 100;
function normalizeLootChanceFilter(value: unknown): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_LOOT_CHANCE_FILTER;
  return Math.round(Math.max(0, Math.min(100, number)) * 100) / 100;
}

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
    resetXpTracker: shortcutsSource.resetXpTracker,
    resetGoldTracker: shortcutsSource.resetGoldTracker,
    toggleMinimap: shortcutsSource.toggleMinimap,
    cycleBossRegion: shortcutsSource.cycleBossRegion,
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
  if (!key || key === "ESCAPE" || !/^(F(?:[1-9]|1[0-9]|2[0-4])|[A-Z0-9]|SPACE|ENTER|TAB|BACKSPACE|DELETE|HOME|END|PAGEUP|PAGEDOWN|ARROWUP|ARROWDOWN|ARROWLEFT|ARROWRIGHT)$/.test(key)) {
    return fallback;
  }
  const modifiers = new Set(tokens.slice(0, -1).map((token) => token.toLowerCase()));
  if ([...modifiers].some((modifier) => !["ctrl", "alt", "shift", "meta"].includes(modifier))) return fallback;
  const orderedModifiers = ["ctrl", "alt", "shift", "meta"].filter((modifier) => modifiers.has(modifier));
  return [...orderedModifiers.map((modifier) => modifier[0]!.toUpperCase() + modifier.slice(1)), key].join("+");
}

function normalizeOpacity(value: unknown, fallback: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.round(Math.max(0, Math.min(1, number)) * 20) / 20;
}

function clampNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.round(Math.max(minimum, Math.min(maximum, number)));
}

async function resolveSettingsPath(settingsPath: string | undefined): Promise<string> {
  if (settingsPath) return settingsPath;
  return path.join(resolveLocalStorageRoot(), "data", "settings", "overlay.json");
}
