import type { RPCSchema } from "electrobun";
import type { FishNetActiveStatus, FishNetDpsEncounterSnapshot } from "@kar-mi/spirit-vale-tools-combat";
import type { CharacterWeight } from "@kar-mi/spirit-vale-tools-character";
import type { WindowChromeRequests } from "@spiritvale/ui-core/window-rpc";

export const OVERLAY_ELEMENT_IDS = ["dpsChart", "personalDps", "partyRanking", "health", "mana", "weight", "buffs", "debuffs", "toggles"] as const;
export type OverlayElementId = (typeof OVERLAY_ELEMENT_IDS)[number];

export const KEYBIND_ACTIONS = ["toggleLock", "resetSession", "toggleOverlayVisible"] as const;
export type KeybindAction = (typeof KEYBIND_ACTIONS)[number];

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
  shortcuts: Record<KeybindAction, string>;
  shortcutErrors: Partial<Record<KeybindAction, string>>;
  overlayVisible: boolean;
  health?: OverlayResource;
  mana?: OverlayResource;
  weight?: CharacterWeight;
  buffs?: FishNetActiveStatus[];
  debuffs?: FishNetActiveStatus[];
  toggles?: FishNetActiveStatus[];
}

type OverlaySharedRequests = {
  getState: { params: Record<string, never>; response: OverlayState };
  setLocked: { params: { locked: boolean }; response: OverlayState };
  setElementEnabled: {
    params: { id: OverlayElementId; enabled: boolean };
    response: OverlayState;
  };
  setOverlayVisible: { params: { visible: boolean }; response: OverlayState };
  setShortcut: { params: { action: KeybindAction; shortcut: string }; response: OverlayState };
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
    };
  }>;
  webview: RPCSchema<{ messages: { stateChanged: OverlayState } }>;
};

export type OverlaySettingsRpc = {
  bun: RPCSchema<{
    requests: OverlaySharedRequests & WindowChromeRequests & {
      closeOverlay: { params: Record<string, never>; response: void };
    };
  }>;
  webview: RPCSchema<{ messages: { stateChanged: OverlayState } }>;
};
