import type { RPCSchema } from "electrobun";
import type { FishNetActiveStatus, FishNetDpsEncounterSnapshot } from "@kar-mi/spirit-vale-tools-combat";
import type { CharacterWeight } from "@kar-mi/spirit-vale-tools-character";
import type { WindowChromeRequests } from "@spiritvale/ui-core/window-rpc";

export const OVERLAY_ELEMENT_IDS = ["dpsChart", "personalDps", "partyRanking", "health", "mana", "weight", "buffs", "debuffs"] as const;
export type OverlayElementId = (typeof OVERLAY_ELEMENT_IDS)[number];

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

export interface OverlayState {
  locked: boolean;
  personalName: string;
  status: OverlayStatus;
  statusDetail: string;
  elements: Record<OverlayElementId, OverlayElementSettings>;
  snapshot?: FishNetDpsEncounterSnapshot;
  snapshotNowMs?: number;
  resetShortcut: string;
  resetShortcutError?: string;
  health?: OverlayResource;
  mana?: OverlayResource;
  weight?: CharacterWeight;
  buffs?: FishNetActiveStatus[];
  debuffs?: FishNetActiveStatus[];
}

type OverlaySharedRequests = {
  getState: { params: Record<string, never>; response: OverlayState };
  setLocked: { params: { locked: boolean }; response: OverlayState };
  setElementEnabled: {
    params: { id: OverlayElementId; enabled: boolean };
    response: OverlayState;
  };
};

export type OverlayRpc = {
  bun: RPCSchema<{
    requests: OverlaySharedRequests & {
      setElementPosition: {
        params: { id: OverlayElementId; x: number; y: number };
        response: OverlayState;
      };
      setElementBounds: {
        params: { id: OverlayElementId; x: number; y: number; width: number; height: number };
        response: OverlayState;
      };
      setElementOpacity: {
        params: { id: OverlayElementId; opacity: number };
        response: OverlayState;
      };
      setResetShortcut: { params: { shortcut: string }; response: OverlayState };
    };
  }>;
  webview: RPCSchema<{ messages: { stateChanged: OverlayState } }>;
};

export type OverlaySettingsRpc = {
  bun: RPCSchema<{
    requests: OverlaySharedRequests & WindowChromeRequests & {
      setResetShortcut: { params: { shortcut: string }; response: OverlayState };
      closeOverlay: { params: Record<string, never>; response: void };
    };
  }>;
  webview: RPCSchema<{ messages: { stateChanged: OverlayState } }>;
};
