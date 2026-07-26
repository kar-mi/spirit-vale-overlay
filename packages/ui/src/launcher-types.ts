import type { RPCSchema } from "electrobun";
import type { WindowFrame } from "@spiritvale/ui-core/window-chrome";
import type { UiScale } from "@spiritvale/ui-core/ui-scale";

export type CaptureStatus = "starting" | "capturing" | "unavailable" | "stopped";
export type ToolWindow = "combat" | "overlay" | "rewards" | "market" | "character";
export type NpcapAvailability = "checking" | "ready" | "missing" | "admin-only" | "error";

export interface CaptureAdapterOption {
  id: string;
  label: string;
}

export interface LauncherState {
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
    };
  }>;
  webview: RPCSchema<{ messages: { stateChanged: LauncherState } }>;
};

export type LauncherSettingsRpc = {
  bun: RPCSchema<{ requests: LauncherSharedRequests }>;
  webview: RPCSchema<{ messages: { stateChanged: LauncherState } }>;
};
