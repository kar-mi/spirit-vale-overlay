import type { RPCSchema } from "electrobun";
import type { WindowFrame } from "@spiritvale/ui-core/window-chrome";
import type { UiScale } from "@spiritvale/ui-core/ui-scale";
import type {
  KeybindAction,
  OverlayElementId,
  OverlaySettingsState,
  RequiredStatusCategory,
} from "@spiritvale/overlay/app-types";

export type CaptureStatus = "starting" | "capturing" | "unavailable" | "stopped";
export type ToolWindow = "combat" | "overlay" | "rewards" | "market" | "character" | "build-export";
export type NpcapAvailability = "checking" | "ready" | "missing" | "admin-only" | "error";

export interface CaptureAdapterOption {
  id: string;
  label: string;
}

export interface LauncherState {
  appVersion: string;
  captureStatus: CaptureStatus;
  statusDetail: string;
  storageWarning?: string;
  npcapAvailability: NpcapAvailability;
  npcapDetail: string;
  npcapVersion?: string;
  selectedAdapter: "auto" | string;
  effectiveAdapter?: string;
  adapterFallback: boolean;
  adapters: CaptureAdapterOption[];
  uiScale: UiScale;
  minimizeToTray: boolean;
  resetMeterOnMapChange: boolean;
  update?: {
    version: string;
    url: string;
  };
}

export interface SharedSettingsState {
  launcher: LauncherState;
  overlay: OverlaySettingsState;
}

type LauncherSharedRequests = {
  getState: { params: Record<string, never>; response: LauncherState };
  setCaptureAdapter: { params: { deviceName: string | null }; response: LauncherState };
  setUiScale: { params: { uiScale: UiScale }; response: LauncherState };
  setMinimizeToTray: { params: { minimizeToTray: boolean }; response: LauncherState };
  refreshCaptureDevices: { params: Record<string, never>; response: LauncherState };
  openNpcapDownload: { params: Record<string, never>; response: void };
  windowAction: { params: { action: "minimize" | "close" }; response: void };
  getWindowFrame: { params: Record<string, never>; response: WindowFrame };
  setWindowFrame: { params: WindowFrame; response: void };
};

export type LauncherRpc = {
  bun: RPCSchema<{
    requests: LauncherSharedRequests & {
      openTool: { params: { tool: ToolWindow }; response: LauncherState };
      openSettings: { params: Record<string, never>; response: void };
      openUpdateRelease: { params: Record<string, never>; response: void };
      skipUpdateVersion: { params: Record<string, never>; response: void };
      dismissUpdateNotification: { params: Record<string, never>; response: void };
    };
  }>;
  webview: RPCSchema<{ messages: { stateChanged: LauncherState } }>;
};

export type LauncherSettingsRpc = {
  bun: RPCSchema<{ requests: {
    getState: { params: Record<string, never>; response: SharedSettingsState };
    setCaptureAdapter: { params: { deviceName: string | null }; response: SharedSettingsState };
    setUiScale: { params: { uiScale: UiScale }; response: SharedSettingsState };
    setMinimizeToTray: { params: { minimizeToTray: boolean }; response: SharedSettingsState };
    setResetMeterOnMapChange: { params: { resetMeterOnMapChange: boolean }; response: SharedSettingsState };
    refreshCaptureDevices: { params: Record<string, never>; response: SharedSettingsState };
    openNpcapDownload: { params: Record<string, never>; response: void };
    setOverlayLocked: { params: { locked: boolean }; response: SharedSettingsState };
    setOverlayElementEnabled: { params: { id: OverlayElementId; enabled: boolean }; response: SharedSettingsState };
    setOverlayVisible: { params: { visible: boolean }; response: SharedSettingsState };
    setShortcut: { params: { action: KeybindAction; shortcut: string }; response: SharedSettingsState };
    setOverlayRequiredStatuses: {
      params: { category: RequiredStatusCategory; statusIds: string[] };
      response: SharedSettingsState;
    };
    windowAction: { params: { action: "minimize" | "close" }; response: void };
    getWindowFrame: { params: Record<string, never>; response: WindowFrame };
    setWindowFrame: { params: WindowFrame; response: void };
  } }>;
  webview: RPCSchema<{ messages: { stateChanged: SharedSettingsState } }>;
};
