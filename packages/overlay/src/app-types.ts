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

export const OVERLAY_ELEMENT_LABELS: Record<OverlayElementId, string> = {
  dpsChart: "DPS chart", personalDps: "Personal DPSs", partyRanking: "Party DPS Meter",
  health: "HP bar", mana: "MP bar", characterXp: "Character XP", jobXp: "Job XP",
  weight: "Weight", xpTracker: "XP Tracker", goldTracker: "Gold Tracker", xpChart: "Character XP chart", buffs: "Buffs",
  debuffs: "Debuffs", toggles: "Toggles", lootToast: "Loot notifications", minimap: "Minimap",
  bossTimers: "Boss timers",
};

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
}

export interface OverlayCharacterState {
  health?: OverlayResource;
  mana?: OverlayResource;
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
