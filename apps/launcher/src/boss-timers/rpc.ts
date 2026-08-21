import type { RPCSchema } from "electrobun";
import type { BossCatalogOption, BossTimer } from "@svoverlay/contracts/boss-timers";

/**
 * Everything the Boss Timers window draws.
 *
 * The window is a view onto the launcher-owned coordinator rather than an owner of anything: the
 * timers keep running whether it is open or not, so opening it late shows the same state the
 * overlay tile has been showing all along.
 */
export interface BossTimerWindowState {
  timers: BossTimer[];
  /** Bosses pickable when logging a gravestone by hand, from the bundled catalog, in level order. */
  options: BossCatalogOption[];
  /** Server instance the player is currently on, e.g. `na3-12`. Absent until capture reports one. */
  currentInstanceId?: string;
  /** Region derived from it, which a manual entry defaults to. */
  currentRegion?: string;
  /** Regions with timers already recorded, so a gravestone can be filed under another one. */
  knownRegions: string[];
  /** Character being played right now, so timers crediting them can be marked. */
  playerName?: string;
}

export type BossTimerRpc = {
  bun: RPCSchema<{
    requests: {
      getState: { params: Record<string, never>; response: BossTimerWindowState };
      /** Records a gravestone the player saw but capture did not. */
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
