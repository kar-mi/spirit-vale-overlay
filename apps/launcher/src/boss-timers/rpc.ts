import type { RPCSchema } from "@svoverlay/contracts/rpc";
import type { BossCatalogOption, BossTimer } from "@svoverlay/contracts/boss-timers";

export interface BossTimerWindowState {
  timers: BossTimer[];
  options: BossCatalogOption[];
  currentInstanceId?: string;
  currentRegion?: string;
  knownRegions: string[];
  playerName?: string;
}

export type BossTimerRpc = {
  bun: RPCSchema<{
    requests: {
      getState: { params: Record<string, never>; response: BossTimerWindowState };
      addTimer: {
        params: { mobId: string; channel: number; region?: string; diedAtMs: number };
        response: BossTimerWindowState;
      };
      removeTimer: { params: { id: string }; response: BossTimerWindowState };
      openSettings: { params: Record<string, never>; response: void };
      windowAction: { params: { action: "minimize" | "close" }; response: void };
      getWindowFrame: { params: Record<string, never>; response: { x: number; y: number; width: number; height: number } };
      setWindowFrame: { params: { x: number; y: number; width: number; height: number }; response: void };
    };
  }>;
  webview: RPCSchema<{ messages: { stateChanged: BossTimerWindowState } }>;
};
