import type { RPCSchema } from "electrobun";

/** Typed renderer contracts for the combat UI windows. */

import type { FishNetDpsActorRow, FishNetDpsEncounterSnapshot } from "@kar-mi/spirit-vale-tools-combat";
import type { DeathLogEntry } from "./death-log.ts";

export type DpsAppTab = "all" | "personal";
export type DpsAppStatus = "waiting" | "capturing" | "loading" | "ready" | "stopped" | "error";

export interface DpsEncounterOption {
  id: string;
  label: string;
}

export interface DpsAppState {
  tab: DpsAppTab;
  status: DpsAppStatus;
  statusDetail: string;
  storageWarning?: string;
  personalName: string;
  personalActorId?: number;
  snapshot?: FishNetDpsEncounterSnapshot;
  resetting: boolean;
}

export type DpsAppRpc = {
  bun: RPCSchema<{
    requests: {
      getState: { params: Record<string, never>; response: DpsAppState };
      openReplayPicker: { params: Record<string, never>; response: void };
      resetSession: { params: Record<string, never>; response: DpsAppState };
      setPersonalName: { params: { name: string }; response: DpsAppState };
      setPersonalActor: { params: { actorId: number | null }; response: DpsAppState };
      setTab: { params: { tab: DpsAppTab }; response: DpsAppState };
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
  snapshot?: FishNetDpsEncounterSnapshot;
}

export interface CombatAnalysisDetailState {
  fileName: string;
  encounterLabel: string;
  encounterDurationMs: number;
  player: FishNetDpsActorRow;
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
      openPlayerDetails: { params: { actorId: number }; response: void };
      openDeathLog: { params: Record<string, never>; response: void };
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
      windowAction: { params: { action: "minimize" | "close" }; response: void };
      getWindowFrame: { params: Record<string, never>; response: { x: number; y: number; width: number; height: number } };
      setWindowFrame: { params: { x: number; y: number; width: number; height: number }; response: void };
    };
  }>;
  webview: RPCSchema<{ messages: { stateChanged: CombatAnalysisDetailState } }>;
};
