import type { RPCSchema } from "electrobun";
import type { FishNetActiveStatus } from "@kar-mi/spirit-vale-tools-combat";
import type { CharacterWeight } from "@kar-mi/spirit-vale-tools-character";
import type { RateSnapshot } from "@kar-mi/spirit-vale-tools-metrics";
import type { StatType } from "@svoverlay/ui-kit/stat-type-select";
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

/** Whether the personal tile shows the whole-encounter average (matches the party meter) or a live, recent-rate estimate. */
export type PersonalDpsMode = "live" | "encounter";

export interface OverlayElementSettings {
  enabled: boolean;
  opacity: number;
  /** Position and size are relative to the top-left of the element's own display, never the virtual desktop. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Bounds-derived key of the monitor this tile lives on; see ./display-layout.ts. */
  display: string;
}

/** A connected monitor, as offered in the Settings window's display pickers. */
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

/** A monitor's position in the virtual desktop, so a surface can map its own coordinates onto it. */
export interface OverlayDisplayPlacement {
  display: string;
  bounds: OverlayDisplayBounds;
}

/**
 * A tile mid-drag, in virtual-desktop coordinates.
 *
 * A window cannot paint outside its own display, so a tile dragged towards the next monitor clips
 * at the bezel. Relaying the gesture lets the other surfaces draw a ghost at the matching spot, so
 * the tile appears to keep travelling instead of sticking to the edge until the mouse is released.
 */
export interface OverlayDragPreview {
  id: OverlayElementId;
  /** Display key of the surface running the gesture; it draws the real tile, not a ghost. */
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
  /** Only the elements assigned to the surface receiving this state — the rest belong to other monitors. */
  elements: Partial<Record<OverlayElementId, OverlayElementSettings>>;
  /** The display this surface covers. Absent on the aggregate state the Settings window reads. */
  surface?: OverlayDisplayPlacement;
  /** Every connected monitor, so a drag released off-screen can work out where it landed. */
  displayLayout: OverlayDisplayPlacement[];
  /** Which metric the party/map meter currently displays. */
  meterStatType: StatType;
  /** Which DPS value the personal tile currently displays. */
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
  /** Character XP and gold dropped come from the same value-agnostic rate tracker. */
  xp: RateSnapshot;
  gold: RateTotals;
}

/**
 * A tracker snapshot without its bucket timeline.
 *
 * Gold has no chart, so publishing its timeline would serialize an hour of one-second buckets
 * (~127KB) on every `publishCharacter`, and retain that again in the `lastCharacterJson` dedupe
 * string, for data nothing reads. XP keeps its timeline because the XP chart draws from it.
 */
export type RateTotals = Omit<RateSnapshot, "timeline">;

export interface OverlayStatusState {
  buffs?: FishNetActiveStatus[];
  debuffs?: FishNetActiveStatus[];
  toggles?: FishNetActiveStatus[];
  /** Of those, the ones not currently active — non-empty means the tile is highlighted. */
  missingStatuses: Record<RequiredStatusCategory, string[]>;
  /**
   * Wall-clock time each `remainingMs` was measured at, so the view can keep counting down between
   * publishes.
   *
   * The overlay publishes when the tracked set changes rather than on a clock, so a buff that is
   * simply running out produces no publish at all until it lapses. The countdowns are ticked in the
   * webview from this stamp instead. It is wall clock deliberately: `remainingMs` is derived from
   * the log's own timeline, which the view has no way to place.
   */
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
    /** Encounter duration this actor's rows are measured over, for the encounter-mode timer. */
    durationMs: number;
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
  /** Connected monitors, for the per-element and home-display pickers. */
  displays: OverlayDisplayOption[];
  /** Resolved home display key — where defaults land and where orphaned tiles fall back to. */
  homeDisplay: string;
  shortcuts: Record<KeybindAction, string>;
  shortcutErrors: Partial<Record<KeybindAction, string>>;
  overlayVisible: boolean;
  requiredStatuses: Record<RequiredStatusCategory, string[]>;
  personalDpsMode: PersonalDpsMode;
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
  setRequiredStatuses: {
    params: { category: RequiredStatusCategory; statusIds: string[] };
    response: OverlayControlState;
  };
  setPersonalDpsMode: { params: { mode: PersonalDpsMode }; response: OverlayControlState };
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
      /**
       * Move and reassign in one step, for a tile dragged onto another monitor. Doing it as two
       * calls would clamp the tile into the old display first and make it visibly jump.
       */
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
      /** Fire-and-forget: sent once per animation frame while a tile is being dragged. */
      dragPreview: OverlayDragPreview;
      dragPreviewEnded: Record<string, never>;
    };
  }>;
  webview: RPCSchema<{ messages: {
    controlChanged: OverlayControlState;
    characterChanged: OverlayCharacterState;
    statusesChanged: OverlayStatusState;
    meterChanged: OverlayMeterState;
    dragPreviewChanged: OverlayDragPreview | undefined;
  } }>;
};
