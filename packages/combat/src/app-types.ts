import type { RPCSchema } from "@svoverlay/contracts/rpc";


import type {
  FishNetDpsActorRow,
  FishNetDpsEncounterSnapshot,
  FishNetDpsSkillRow,
  FishNetDpsTimelinePoint,
} from "@kar-mi/spirit-vale-tools-combat";
import type { MeterActorRow } from "@svoverlay/contracts/meter";
import type { DeathLogEntry } from "./death-log.ts";
import type { SessionPickerState } from "@svoverlay/desktop-platform/session-picker-types";
import type { EnemyDamageRow, EnemyOption } from "./enemy-breakdown.ts";
import type { SpiritValeLocation } from "@svoverlay/desktop-platform/location";
import type { SessionDateRange } from "@svoverlay/desktop-platform/session-summary-journal";

export type { StatType } from "@svoverlay/ui-kit/stat-type-select";
import type { StatType } from "@svoverlay/ui-kit/stat-type-select";

export type MeterTimelinePoint = FishNetDpsTimelinePoint;
export type { MeterActorRow } from "@svoverlay/contracts/meter";
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
  location?: SpiritValeLocation;
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
      setPastDateRange: { params: SessionDateRange; response: DpsAppState };
      setPastZones: { params: { zones: string[] }; response: DpsAppState };
      openPastSession: { params: { id: string }; response: void };
      choosePastFile: { params: Record<string, never>; response: void };
      openPastLogFolder: { params: Record<string, never>; response: void };
      backToPastSessions: { params: Record<string, never>; response: DpsAppState };
      selectPastEncounter: { params: { id: string }; response: DpsAppState };
      setPastStatType: { params: { statType: StatType }; response: DpsAppState };
      openPlayerDetails: {
        params:
          | { source: "live"; actorId: number; selectedEnemyIds: number[] }
          | { source: "past"; rowId: string; selectedEnemyIds: number[] };
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
  enemies: EnemyOption[];
  actorEnemyBreakdown: Record<string, EnemyDamageRow[]>;
  /** TPS enemy filter: the attacker list and per-victim damage taken keyed by attacker. */
  tankedEnemies: EnemyOption[];
  tankedActorEnemyBreakdown: Record<string, EnemyDamageRow[]>;
}

export interface CombatAnalysisDetailState {
  fileName: string;
  encounterLabel: string;
  encounterDurationMs: number;
  statType: StatType;
  selectedEnemyIds: number[];
  player: FishNetDpsActorRow;
  tankedPlayer?: MeterActorRow;
  healPlayer?: MeterActorRow;
  enemies: EnemyOption[];
  /** Attackers that hit this player, for the enemy filter when the popup is on the TPS view. */
  tankedEnemies: EnemyOption[];
  skillsByEnemy: Record<number, FishNetDpsSkillRow[]>;
  /** Tanked meter: incoming enemy skills per attacker, for the per-enemy breakdown in the popup. */
  tankedSkillsByEnemy?: Record<number, FishNetDpsSkillRow[]>;
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
