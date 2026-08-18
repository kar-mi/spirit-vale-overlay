import type { RPCSchema } from "electrobun";
import type { WindowFrame } from "@svoverlay/ui-kit/window-chrome";
import type { UiScale } from "@svoverlay/desktop-platform/ui-scale";
import type {
  KeybindAction,
  OverlayElementId,
  OverlaySettingsState,
  PersonalDpsMode,
  RequiredStatusCategory,
} from "@svoverlay/overlay/app-types";

export type CaptureStatus = "starting" | "capturing" | "unavailable" | "stopped";
export type ToolWindow = "combat" | "overlay" | "rewards" | "character" | "build-export";
export type NpcapAvailability = "checking" | "ready" | "missing" | "admin-only" | "error";

export interface CaptureAdapterOption {
  id: string;
  label: string;
}

/** Log directory usage as measured once at launch. Undefined until the walk finishes, or if it failed. */
export interface LogStorageState {
  bytes: number;
  files: number;
  measuredAt: string;
}

export interface LauncherState {
  appVersion: string;
  captureStatus: CaptureStatus;
  statusDetail: string;
  storageWarning?: string;
  logStorage?: LogStorageState;
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
  resetGoldOnMapChange: boolean;
  /** Overlay keybinds, shown as a hint on the launcher. Absent until the overlay has started. */
  overlayShortcuts?: Record<KeybindAction, string>;
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
      manageSettings: { params: Record<string, never>; response: void };
      openUpdateRelease: { params: Record<string, never>; response: void };
      skipUpdateVersion: { params: Record<string, never>; response: void };
      dismissUpdateNotification: { params: Record<string, never>; response: void };
    };
  }>;
  webview: RPCSchema<{ messages: { stateChanged: LauncherState } }>;
};

export interface ManageSettingsState {
  dataFolder: string;
}

export type ManageSettingsRpc = {
  bun: RPCSchema<{
    requests: {
      getState: { params: Record<string, never>; response: ManageSettingsState };
      importSettings: { params: Record<string, never>; response: void };
      openDataFolder: { params: Record<string, never>; response: void };
      resetSettings: { params: Record<string, never>; response: void };
      windowAction: { params: { action: "minimize" | "close" }; response: void };
      getWindowFrame: { params: Record<string, never>; response: WindowFrame };
      setWindowFrame: { params: WindowFrame; response: void };
    };
  }>;
  webview: RPCSchema<{ messages: Record<string, never> }>;
};

export type LauncherSettingsRpc = {
  bun: RPCSchema<{ requests: {
    getState: { params: Record<string, never>; response: SharedSettingsState };
    setCaptureAdapter: { params: { deviceName: string | null }; response: SharedSettingsState };
    setUiScale: { params: { uiScale: UiScale }; response: SharedSettingsState };
    setMinimizeToTray: { params: { minimizeToTray: boolean }; response: SharedSettingsState };
    setResetMeterOnMapChange: { params: { resetMeterOnMapChange: boolean }; response: SharedSettingsState };
    setResetGoldOnMapChange: { params: { resetGoldOnMapChange: boolean }; response: SharedSettingsState };
    refreshCaptureDevices: { params: Record<string, never>; response: SharedSettingsState };
    openNpcapDownload: { params: Record<string, never>; response: void };
    setOverlayLocked: { params: { locked: boolean }; response: SharedSettingsState };
    setOverlayElementEnabled: { params: { id: OverlayElementId; enabled: boolean }; response: SharedSettingsState };
    setOverlayElementDisplay: { params: { id: OverlayElementId; display: string }; response: SharedSettingsState };
    setOverlayHomeDisplay: { params: { display: string }; response: SharedSettingsState };
    setOverlayVisible: { params: { visible: boolean }; response: SharedSettingsState };
    setShortcut: { params: { action: KeybindAction; shortcut: string }; response: SharedSettingsState };
    resetShortcutsToDefaults: { params: Record<string, never>; response: SharedSettingsState };
    setShortcutCapture: { params: { active: boolean }; response: SharedSettingsState };
    setOverlayRequiredStatuses: {
      params: { category: RequiredStatusCategory; statusIds: string[] };
      response: SharedSettingsState;
    };
    setPersonalDpsMode: { params: { mode: PersonalDpsMode }; response: SharedSettingsState };
    windowAction: { params: { action: "minimize" | "close" }; response: void };
    getWindowFrame: { params: Record<string, never>; response: WindowFrame };
    setWindowFrame: { params: WindowFrame; response: void };
  } }>;
  webview: RPCSchema<{ messages: { stateChanged: SharedSettingsState } }>;
};
