import type { RPCSchema } from "electrobun";

/** Typed renderer contracts for the combat UI windows. */

import type {
  FishNetDpsActorRow,
  FishNetDpsEncounterSnapshot,
  FishNetDpsSkillRow,
  FishNetDpsTimelinePoint,
  FishNetPersonalMatch,
} from "@kar-mi/spirit-vale-tools-combat";
import type { DeathLogEntry } from "./death-log.ts";
import type { SessionPickerState } from "@spiritvale/ui-core/session-picker-types";
import type { EnemyDamageRow, EnemyOption } from "./enemy-breakdown.ts";

export type { StatType } from "@spiritvale/ui-core/stat-type-select";
import type { StatType } from "@spiritvale/ui-core/stat-type-select";

/**
 * The tanked and healing meters render with the same detail as the DPS meter, and upstream builds
 * all three through one reducer, so these are that package's row types rather than parallel copies.
 */
export type MeterSkillRow = FishNetDpsSkillRow;
export type MeterTimelinePoint = FishNetDpsTimelinePoint;
export type MeterActorRow = FishNetDpsActorRow;
export type MeterPersonalMatch = FishNetPersonalMatch;
export type MeterEncounterSnapshot = FishNetDpsEncounterSnapshot;

export type DpsAppTab = "all" | "personal";
export type CombatLogScreen = "live" | "past";
export type DpsAppStatus = "waiting" | "capturing" | "loading" | "ready" | "stopped" | "error";

export interface DpsEncounterOption {
  id: string;
  label: string;
}

export interface DpsAppState {
  screen: CombatLogScreen;
  tab: DpsAppTab;
  statType: StatType;
  status: DpsAppStatus;
  statusDetail: string;
  storageWarning?: string;
  personalName: string;
  personalActorId?: number;
  snapshot?: FishNetDpsEncounterSnapshot;
  tankedSnapshot?: MeterEncounterSnapshot;
  healSnapshot?: MeterEncounterSnapshot;
  resetting: boolean;
  liveDeathLogAvailable: boolean;
  past:
    | { view: "selector"; picker: SessionPickerState }
    | { view: "analysis"; analysis: CombatAnalysisState };
}

export type DpsAppRpc = {
  bun: RPCSchema<{
    requests: {
      getState: { params: Record<string, never>; response: DpsAppState };
      setScreen: { params: { screen: CombatLogScreen }; response: DpsAppState };
      refreshPastSessions: { params: Record<string, never>; response: void };
      openPastSession: { params: { id: string }; response: void };
      choosePastFile: { params: Record<string, never>; response: void };
      openPastLogFolder: { params: Record<string, never>; response: void };
      backToPastSessions: { params: Record<string, never>; response: DpsAppState };
      selectPastEncounter: { params: { id: string }; response: DpsAppState };
      setPastStatType: { params: { statType: StatType }; response: DpsAppState };
      openPlayerDetails: {
        params: { source: CombatLogScreen; actorId: number; selectedEnemyIds: number[] };
        response: void;
      };
      openActiveDeathLog: { params: Record<string, never>; response: void };
      openSettings: { params: Record<string, never>; response: void };
      resetSession: { params: Record<string, never>; response: DpsAppState };
      setPersonalActor: { params: { actorId: number | null }; response: DpsAppState };
      setTab: { params: { tab: DpsAppTab }; response: DpsAppState };
      setStatType: { params: { statType: StatType }; response: DpsAppState };
      windowAction: { params: { action: "minimize" | "close" }; response: void };
      getWindowFrame: { params: Record<string, never>; response: { x: number; y: number; width: number; height: number } };
      setWindowFrame: { params: { x: number; y: number; width: number; height: number }; response: void };
    };
  }>;
  webview: RPCSchema<{
    messages: {
      stateChanged: DpsAppState;
    };
  }>;
};

export interface CombatAnalysisState {
  status: "loading" | "ready" | "error";
  statusDetail: string;
  fileName?: string;
  invalidLines: number;
  encounters: DpsEncounterOption[];
  selectedEncounterId?: string;
  statType: StatType;
  snapshot?: FishNetDpsEncounterSnapshot;
  tankedSnapshot?: MeterEncounterSnapshot;
  healSnapshot?: MeterEncounterSnapshot;
  /** Enemies fought during the selected encounter, for the enemy filter control. */
  enemies: EnemyOption[];
  /** Per-enemy damage for each actor row, keyed by that row's actorIds[0]. */
  actorEnemyBreakdown: Record<number, EnemyDamageRow[]>;
}

export interface CombatAnalysisDetailState {
  fileName: string;
  encounterLabel: string;
  encounterDurationMs: number;
  statType: StatType;
  /** Enemy filter inherited from the analysis overview when this player was opened. */
  selectedEnemyIds: number[];
  player: FishNetDpsActorRow;
  tankedPlayer?: MeterActorRow;
  healPlayer?: MeterActorRow;
  /** Enemies this player damaged during the encounter, for the enemy filter control. */
  enemies: EnemyOption[];
  /** This player's skill breakdown scoped to a single enemy, keyed by targetId. */
  skillsByEnemy: Record<number, FishNetDpsSkillRow[]>;
}

export interface CombatDeathLogState {
  fileName: string;
  deaths: readonly DeathLogEntry[];
  selectedDeathId?: string;
  invalidLines: number;
}

export type CombatDeathLogRpc = {
  bun: RPCSchema<{
    requests: {
      getState: { params: Record<string, never>; response: CombatDeathLogState };
      selectDeath: { params: { id: string }; response: CombatDeathLogState };
      openSettings: { params: Record<string, never>; response: void };
      windowAction: { params: { action: "minimize" | "close" }; response: void };
      getWindowFrame: { params: Record<string, never>; response: { x: number; y: number; width: number; height: number } };
      setWindowFrame: { params: { x: number; y: number; width: number; height: number }; response: void };
    };
  }>;
  webview: RPCSchema<{ messages: { stateChanged: CombatDeathLogState } }>;
};

export type CombatAnalysisDetailRpc = {
  bun: RPCSchema<{
    requests: {
      getState: { params: Record<string, never>; response: CombatAnalysisDetailState };
      openSettings: { params: Record<string, never>; response: void };
      windowAction: { params: { action: "minimize" | "close" }; response: void };
      getWindowFrame: { params: Record<string, never>; response: { x: number; y: number; width: number; height: number } };
      setWindowFrame: { params: { x: number; y: number; width: number; height: number }; response: void };
    };
  }>;
  webview: RPCSchema<{ messages: { stateChanged: CombatAnalysisDetailState } }>;
};
