import type { RPCSchema } from "@svoverlay/contracts/rpc";
import type { FishNetActiveStatus } from "@kar-mi/spirit-vale-tools-combat";
import type { CharacterWeight } from "@kar-mi/spirit-vale-tools-character";
import type { RateSnapshot } from "@kar-mi/spirit-vale-tools-metrics";
import type { StatType } from "@svoverlay/ui-kit/stat-type-select";
import type { BossTimerState } from "@svoverlay/contracts/boss-timers";
import type { RequiredStatusCategory } from "./required-statuses.ts";

export type { StatType, RequiredStatusCategory };
export type { BossTimer, BossTimerState } from "@svoverlay/contracts/boss-timers";

export const OVERLAY_ELEMENT_IDS = ["dpsChart", "personalDps", "partyRanking", "health", "mana", "characterXp", "jobXp", "weight", "xpTracker", "goldTracker", "xpChart", "buffs", "debuffs", "toggles", "lootToast", "minimap", "bossTimers"] as const;
export type OverlayElementId = (typeof OVERLAY_ELEMENT_IDS)[number];

export const KEYBIND_ACTIONS = ["toggleLock", "resetSession", "openLiveDeathLog", "toggleOverlayVisible", "cycleMeterStatType", "resetXpTracker", "resetGoldTracker", "toggleMinimap", "cycleBossRegion"] as const;
export type KeybindAction = (typeof KEYBIND_ACTIONS)[number];

export const METER_STAT_TYPE_CYCLE: readonly StatType[] = ["damage", "heal", "tanked"];

export type PersonalDpsMode = "live" | "encounter";

export interface OverlayElementSettings {
  enabled: boolean;
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  display: string;
}

export interface ElementSize {
  width: number;
  height: number;
}

const MIN_ELEMENT_WIDTH = 160;
const MIN_ELEMENT_HEIGHT = 100;
const MIN_BAR_HEIGHT = 24;
const MIN_COMPACT_ELEMENT_HEIGHT = 40;

const MIN_ELEMENT_HEIGHTS: Partial<Record<OverlayElementId, number>> = {
  health: MIN_BAR_HEIGHT,
  mana: MIN_BAR_HEIGHT,
  characterXp: MIN_BAR_HEIGHT,
  jobXp: MIN_BAR_HEIGHT,
  weight: MIN_COMPACT_ELEMENT_HEIGHT,
  buffs: MIN_COMPACT_ELEMENT_HEIGHT,
  debuffs: MIN_COMPACT_ELEMENT_HEIGHT,
  toggles: MIN_COMPACT_ELEMENT_HEIGHT,
  bossTimers: MIN_COMPACT_ELEMENT_HEIGHT,
};

export const ELEMENT_MIN_SIZE: Record<OverlayElementId, ElementSize> = Object.fromEntries(
  OVERLAY_ELEMENT_IDS.map((id) => [id, {
    width: MIN_ELEMENT_WIDTH,
    height: MIN_ELEMENT_HEIGHTS[id] ?? MIN_ELEMENT_HEIGHT,
  }]),
) as Record<OverlayElementId, ElementSize>;

export function minimumSizeFor(id: OverlayElementId): ElementSize {
  return ELEMENT_MIN_SIZE[id];
}

export interface OverlayDisplayOption {
  key: string;
  label: string;
  primary: boolean;
}

export interface OverlayDisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayDisplayPlacement {
  display: string;
  bounds: OverlayDisplayBounds;
}

export interface OverlayDragPreview {
  id: OverlayElementId;
  origin: string;
  rect: OverlayDisplayBounds;
}

export type OverlayStatus = "waiting" | "capturing" | "ready" | "error";

export interface OverlayResource {
  current: number;
  maximum: number;
}

export interface OverlayExperienceProgress extends OverlayResource {
  capped: boolean;
}

export interface OverlayControlState {
  locked: boolean;
  personalName: string;
  status: OverlayStatus;
  statusDetail: string;
  elements: Partial<Record<OverlayElementId, OverlayElementSettings>>;
  surface?: OverlayDisplayPlacement;
  displayLayout: OverlayDisplayPlacement[];
  meterStatType: StatType;
  personalDpsMode: PersonalDpsMode;
  shortcuts: Record<KeybindAction, string>;
  shortcutErrors: Partial<Record<KeybindAction, string>>;
  overlayVisible: boolean;
  requiredStatuses: Record<RequiredStatusCategory, string[]>;
  minimapEnabled: boolean;
}

export interface OverlayCharacterState {
  health?: OverlayResource;
  mana?: OverlayResource;
  shield?: number;
  characterXp?: OverlayExperienceProgress;
  jobXp?: OverlayExperienceProgress;
  weight?: CharacterWeight;
  xp: RateSnapshot;
  gold: RateTotals;
}

export type RateTotals = Omit<RateSnapshot, "timeline">;

export interface OverlayStatusState {
  buffs?: FishNetActiveStatus[];
  debuffs?: FishNetActiveStatus[];
  toggles?: FishNetActiveStatus[];
  missingStatuses: Record<RequiredStatusCategory, string[]>;
  asOfMs: number;
}

export interface OverlayMeterPoint {
  elapsedMs: number;
  dps: number;
}

export interface OverlayMeterActor {
  actorId: number;
  displayName: string;
  archetype?: number;
  dps: number;
}

export interface OverlayMeterState {
  personalChart: boolean;
  chartDurationMs: number;
  chart: OverlayMeterPoint[];
  partyDurationMs: number;
  party: OverlayMeterActor[];
  personal?: {
    archetype?: number;
    currentDps: number;
    damage: number;
    critRate?: number;
    durationMs: number;
  };
}

export interface OverlayViewState {
  control: OverlayControlState;
  character: OverlayCharacterState;
  statuses: OverlayStatusState;
  meter: OverlayMeterState;
  minimap: OverlayMinimapState;
  bossTimers: BossTimerState;
}

export interface OverlayLootToastEvent {
  objectId: number;
  displayName?: string;
  rarity?: number;
  spriteId?: string;
  lootChance?: number;
}

export interface OverlayMinimapLootDrop {
  objectId: number;
  x: number;
  z: number;
  displayName?: string;
  spriteId?: string;
  rarity?: number;
  lootType?: number;
  lootChance?: number;
}

export interface OverlayMinimapState {
  player?: { x: number; z: number; heading?: number };
  loot: OverlayMinimapLootDrop[];
  rarityFilter: number;
  lootChanceFilter: number;
}

export interface OverlaySettingsState {
  locked: boolean;
  personalName: string;
  elements: Record<OverlayElementId, OverlayElementSettings>;
  displays: OverlayDisplayOption[];
  homeDisplay: string;
  shortcuts: Record<KeybindAction, string>;
  shortcutErrors: Partial<Record<KeybindAction, string>>;
  overlayVisible: boolean;
  requiredStatuses: Record<RequiredStatusCategory, string[]>;
  personalDpsMode: PersonalDpsMode;
  autoHideWhenUnfocused: boolean;
  minimapEnabled: boolean;
  minimapRarityFilter: number;
  minimapLootChanceFilter: number;
}

type OverlaySharedRequests = {
  getState: { params: Record<string, never>; response: OverlayViewState };
  setLocked: { params: { locked: boolean }; response: OverlayControlState };
  setElementEnabled: {
    params: { id: OverlayElementId; enabled: boolean };
    response: OverlayControlState;
  };
  setElementDisplay: {
    params: { id: OverlayElementId; display: string };
    response: OverlayControlState;
  };
  setHomeDisplay: { params: { display: string }; response: OverlayControlState };
  setOverlayVisible: { params: { visible: boolean }; response: OverlayControlState };
  setShortcut: { params: { action: KeybindAction; shortcut: string }; response: OverlayControlState };
  resetShortcutsToDefaults: { params: Record<string, never>; response: OverlayControlState };
  setRequiredStatuses: {
    params: { category: RequiredStatusCategory; statusIds: string[] };
    response: OverlayControlState;
  };
  setPersonalDpsMode: { params: { mode: PersonalDpsMode }; response: OverlayControlState };
  resetXpTracker: { params: Record<string, never>; response: OverlayCharacterState };
  resetGoldTracker: { params: Record<string, never>; response: OverlayCharacterState };
  setMinimapEnabled: { params: { enabled: boolean }; response: OverlayControlState };
  setMinimapRarityFilter: { params: { rarity: number }; response: OverlayMinimapState };
  setMinimapLootChanceFilter: { params: { chance: number }; response: OverlayMinimapState };
};

export type OverlayRpc = {
  bun: RPCSchema<{
    requests: OverlaySharedRequests & {
      setElementPosition: {
        params: { id: OverlayElementId; x: number; y: number };
        response: OverlayControlState;
      };
      setElementBounds: {
        params: { id: OverlayElementId; x: number; y: number; width: number; height: number };
        response: OverlayControlState;
      };
      setElementPlacement: {
        params: { id: OverlayElementId; display: string; x: number; y: number };
        response: OverlayControlState;
      };
      setElementOpacity: {
        params: { id: OverlayElementId; opacity: number };
        response: OverlayControlState;
      };
    };
    messages: {
      dragPreview: OverlayDragPreview;
      dragPreviewEnded: Record<string, never>;
    };
  }>;
  webview: RPCSchema<{ messages: {
    controlChanged: OverlayControlState;
    characterChanged: OverlayCharacterState;
    statusesChanged: OverlayStatusState;
    meterChanged: OverlayMeterState;
    bossTimersChanged: BossTimerState;
    dragPreviewChanged: OverlayDragPreview | undefined;
    minimapChanged: OverlayMinimapState;
    lootDropped: OverlayLootToastEvent;
  } }>;
};
