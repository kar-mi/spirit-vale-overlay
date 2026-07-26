import type { RPCSchema } from "electrobun";
import type { RewardLogStatus } from "@kar-mi/spirit-vale-tools-rewards";
import type { MaximizableWindowChromeRequests } from "@spiritvale/ui-core/window-rpc";

export type RewardsAppMode = "live" | "replay";
export type RewardsAppView = "summary" | "recent" | "trends";
export type RewardsAppStatus = RewardLogStatus;

export interface RewardsUiDrop { category: string; itemId: string; itemName: string; count: number; chance?: number }
export interface RewardsUiMob {
  id: string;
  displayName: string;
  level: number;
  boss: boolean;
  baseExperience: number;
  baseCoins: number;
  drops: RewardsUiDrop[];
}
export interface RewardsUiKill {
  id: string;
  timestamp?: string;
  mobId: string;
  displayName: string;
  level: number;
  experience: number;
  jobExperience: number;
  coins: string;
  drops: RewardsUiDrop[];
}
export interface RewardsUiSummary {
  mobId: string;
  displayName: string;
  level: number;
  kills: number;
  experience: number;
  jobExperience: number;
  coins: string;
  drops: RewardsUiDrop[];
}

export interface RewardsUiGraphSample {
  recordedAt: string;
  experience: number;
  jobExperience: number;
  coins: string;
}

export interface RewardsAppState {
  mode: RewardsAppMode;
  view: RewardsAppView;
  status: RewardsAppStatus;
  statusDetail: string;
  storageWarning?: string;
  pinned: boolean;
  resetting: boolean;
  replayFileName?: string;
  replayWarnings: number;
  kills: RewardsUiKill[];
  graphSamples: RewardsUiGraphSample[];
  summaries: RewardsUiSummary[];
  totalExperience: number;
  totalJobExperience: number;
  totalCoins: string;
  unmatched: number;
  unmatchedDrops: RewardsUiDrop[];
  unidentified: number;
}

export type RewardsAppRpc = {
  bun: RPCSchema<{
    requests: MaximizableWindowChromeRequests & {
      getState: { params: Record<string, never>; response: RewardsAppState };
      setMode: { params: { mode: RewardsAppMode }; response: RewardsAppState };
      setView: { params: { view: RewardsAppView }; response: RewardsAppState };
      openCatalog: { params: Record<string, never>; response: void };
      openReplayPicker: { params: Record<string, never>; response: void };
      setPinned: { params: { pinned: boolean }; response: RewardsAppState };
      resetSession: { params: Record<string, never>; response: RewardsAppState };
    };
  }>;
  webview: RPCSchema<{ messages: { stateChanged: RewardsAppState } }>;
};

export interface RewardsCatalogState {
  query: string;
  catalog: RewardsUiMob[];
  catalogCount: number;
}

export type RewardsCatalogRpc = {
  bun: RPCSchema<{
    requests: MaximizableWindowChromeRequests & {
      getState: { params: Record<string, never>; response: RewardsCatalogState };
      setQuery: { params: { query: string }; response: RewardsCatalogState };
    };
  }>;
  webview: RPCSchema<{ messages: { stateChanged: RewardsCatalogState } }>;
};
