import type { RPCSchema } from "electrobun";

/** Typed renderer contracts for the combat UI windows. */

import type { FishNetDpsActorRow, FishNetDpsEncounterSnapshot, FishNetDpsSkillRow } from "@kar-mi/spirit-vale-tools-combat";
import type { DeathLogEntry } from "./death-log.ts";
import type { EnemyDamageRow, EnemyOption } from "./enemy-breakdown.ts";

export type { StatType } from "@spiritvale/ui-core/stat-type-select";
import type { StatType } from "@spiritvale/ui-core/stat-type-select";

export interface MeterSkillRow {
  sourceId: string;
  sourceLabel: string;
  damage: number;
  dps: number;
  contribution: number;
  hits: number;
  criticalHits: number;
  critRate?: number;
}

export interface MeterTimelinePoint {
  elapsedMs: number;
  damage: number;
  cumulativeDamage: number;
  dps: number;
}

export interface MeterActorRow {
  actorIds: number[];
  displayName: string;
  archetype?: number;
  durationMs?: number;
  lastDamageAtMs?: number;
  damage: number;
  dps: number;
  currentDps: number;
  contribution: number;
  hits: number;
  criticalHits: number;
  critRate?: number;
  kills: number;
  mobsHit: number;
  skills: MeterSkillRow[];
  timeline: MeterTimelinePoint[];
  isUnidentified?: boolean;
}

export type MeterPersonalMatch = "unconfigured" | "missing" | "matched" | "ambiguous";

export interface MeterEncounterSnapshot {
  id: string;
  startedAtMs: number;
  lastDamageAtMs: number;
  endedAtMs?: number;
  durationMs: number;
  totalDamage: number;
  partyDps: number;
  partyCurrentDps: number;
  actors: MeterActorRow[];
  personalName: string;
  personalMatch: MeterPersonalMatch;
  personal?: MeterActorRow;
}

export type DpsAppTab = "all" | "personal";
export type DpsAppStatus = "waiting" | "capturing" | "loading" | "ready" | "stopped" | "error";

export interface DpsEncounterOption {
  id: string;
  label: string;
}

export interface DpsAppState {
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
}

export type DpsAppRpc = {
  bun: RPCSchema<{
    requests: {
      getState: { params: Record<string, never>; response: DpsAppState };
      openReplayPicker: { params: Record<string, never>; response: void };
      openLiveDeathLog: { params: Record<string, never>; response: void };
      openSettings: { params: Record<string, never>; response: void };
      resetSession: { params: Record<string, never>; response: DpsAppState };
      setPersonalName: { params: { name: string }; response: DpsAppState };
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

export type CombatAnalysisRpc = {
  bun: RPCSchema<{
    requests: {
      getState: { params: Record<string, never>; response: CombatAnalysisState };
      selectEncounter: { params: { id: string }; response: CombatAnalysisState };
      setStatType: { params: { statType: StatType }; response: CombatAnalysisState };
      openPlayerDetails: { params: { actorId: number; selectedEnemyIds: number[] }; response: void };
      openDeathLog: { params: Record<string, never>; response: void };
      openSettings: { params: Record<string, never>; response: void };
      windowAction: { params: { action: "minimize" | "close" }; response: void };
      getWindowFrame: { params: Record<string, never>; response: { x: number; y: number; width: number; height: number } };
      setWindowFrame: { params: { x: number; y: number; width: number; height: number }; response: void };
    };
  }>;
  webview: RPCSchema<{ messages: { stateChanged: CombatAnalysisState } }>;
};

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
