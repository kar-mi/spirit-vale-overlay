import type { RPCSchema } from "electrobun";
import type { FishNetActiveStatus } from "@kar-mi/spirit-vale-tools-combat";
import type { CharacterWeight } from "@kar-mi/spirit-vale-tools-character";
import type { XpAggregateSnapshot } from "@kar-mi/spirit-vale-tools-rewards";
import type { StatType } from "@spiritvale/ui-core/stat-type-select";
import type { RequiredStatusCategory } from "./required-statuses.ts";

export type { StatType, RequiredStatusCategory };

export const OVERLAY_ELEMENT_IDS = ["dpsChart", "personalDps", "partyRanking", "health", "mana", "characterXp", "jobXp", "weight", "xpTracker", "goldTracker", "xpChart", "buffs", "debuffs", "toggles"] as const;
export type OverlayElementId = (typeof OVERLAY_ELEMENT_IDS)[number];

/** Short label describing each overlay element, shown in the settings toggle list and as an edit-mode badge on the element itself. */
export const OVERLAY_ELEMENT_LABELS: Record<OverlayElementId, string> = {
  dpsChart: "DPS chart", personalDps: "Personal DPS numbers", partyRanking: "Party DPS ranking",
  health: "HP bar", mana: "MP bar", characterXp: "Character XP bar", jobXp: "Job XP bar",
  weight: "Weight", xpTracker: "Character XP numbers", goldTracker: "Gold dropped", xpChart: "Character XP chart", buffs: "Buffs",
  debuffs: "Debuffs", toggles: "Toggles (no timer)",
};

export const KEYBIND_ACTIONS = ["toggleLock", "resetSession", "openLiveDeathLog", "toggleOverlayVisible", "cycleMeterStatType"] as const;
export type KeybindAction = (typeof KEYBIND_ACTIONS)[number];

/** Party/map meter cycles damage -> heal -> tanked -> damage on each press of its keybind. */
export const METER_STAT_TYPE_CYCLE: readonly StatType[] = ["damage", "heal", "tanked"];

export interface OverlayElementSettings {
  enabled: boolean;
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
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
  elements: Record<OverlayElementId, OverlayElementSettings>;
  /** Which metric the party/map meter currently displays. */
  meterStatType: StatType;
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
  xp: XpAggregateSnapshot;
  gold: CoinsAggregateSnapshot;
}

/** Gold aggregate mirroring the XP tracker: total dropped, EWMA per-second rate, and the last hour's sum. */
export interface CoinsAggregateBucket {
  atMs: number;
  coins: number;
}
export interface CoinsAggregateSnapshot {
  totalCoins: number;
  coinsPerSecond: number;
  coinsPerHour: number;
  timeline: CoinsAggregateBucket[];
}

export interface OverlayStatusState {
  buffs?: FishNetActiveStatus[];
  debuffs?: FishNetActiveStatus[];
  toggles?: FishNetActiveStatus[];
  /** Of those, the ones not currently active — non-empty means the tile is highlighted. */
  missingStatuses: Record<RequiredStatusCategory, string[]>;
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
  /** True when the chart represents the configured personal actor rather than the map total. */
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
  };
}

export interface OverlayViewState {
  control: OverlayControlState;
  character: OverlayCharacterState;
  statuses: OverlayStatusState;
  meter: OverlayMeterState;
}

/** The subset consumed by the separate Settings window. */
export interface OverlaySettingsState {
  locked: boolean;
  personalName: string;
  elements: Record<OverlayElementId, OverlayElementSettings>;
  shortcuts: Record<KeybindAction, string>;
  shortcutErrors: Partial<Record<KeybindAction, string>>;
  overlayVisible: boolean;
  requiredStatuses: Record<RequiredStatusCategory, string[]>;
}

type OverlaySharedRequests = {
  getState: { params: Record<string, never>; response: OverlayViewState };
  setLocked: { params: { locked: boolean }; response: OverlayControlState };
  setElementEnabled: {
    params: { id: OverlayElementId; enabled: boolean };
    response: OverlayControlState;
  };
  setOverlayVisible: { params: { visible: boolean }; response: OverlayControlState };
  setShortcut: { params: { action: KeybindAction; shortcut: string }; response: OverlayControlState };
  setRequiredStatuses: {
    params: { category: RequiredStatusCategory; statusIds: string[] };
    response: OverlayControlState;
  };
  resetXpTracker: { params: Record<string, never>; response: OverlayCharacterState };
  resetGoldTracker: { params: Record<string, never>; response: OverlayCharacterState };
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
      setElementOpacity: {
        params: { id: OverlayElementId; opacity: number };
        response: OverlayControlState;
      };
    };
  }>;
  webview: RPCSchema<{ messages: {
    controlChanged: OverlayControlState;
    characterChanged: OverlayCharacterState;
    statusesChanged: OverlayStatusState;
    meterChanged: OverlayMeterState;
  } }>;
};
