import type { RPCSchema } from "@svoverlay/contracts/rpc";
import type { WindowFrame } from "@svoverlay/ui-kit/window-chrome";
import type { UiScale } from "@svoverlay/desktop-platform/ui-scale";
import type {
  KeybindAction,
  OverlayElementId,
  OverlaySettingsState,
  PersonalDpsMode,
  RequiredStatusCategory,
} from "@svoverlay/overlay/app-types";
import type { SettingsKind } from "../desktop/manage-settings.ts";

export type CaptureStatus = "starting" | "capturing" | "unavailable" | "stopped";
export type CaptureWarningCode = "no-game-udp" | "unrecognized-game-udp" | "fishnet-decode-stalled" | "fishnet-data-delayed";

export interface CaptureHealthWarning {
  code: CaptureWarningCode;
  message: string;
  detectedAt: string;
}
export type ToolWindow = "combat" | "overlay" | "rewards" | "character" | "build-export" | "boss-timers";
export type NpcapAvailability = "checking" | "ready" | "missing" | "admin-only" | "error";

export interface CaptureAdapterOption {
  id: string;
  label: string;
}

export interface LogStorageState {
  bytes: number;
  files: number;
  measuredAt: string;
}

export interface LauncherState {
  appVersion: string;
  captureStatus: CaptureStatus;
  statusDetail: string;
  captureWarning?: CaptureHealthWarning;
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
  overlayShortcuts?: Record<KeybindAction, string>;
  update?: {
    version: string;
    url: string;
  };
}

export type SettingsSectionId =
  | "general"
  | "network"
  | "overlay"
  | "combat"
  | "status"
  | "keybinds"
  | "minimap"
  | "manage";

export interface SharedSettingsState {
  launcher: LauncherState;
  overlay: OverlaySettingsState;
  dataFolder: string;
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
      openSettings: { params: { section?: SettingsSectionId }; response: void };
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
    setResetGoldOnMapChange: { params: { resetGoldOnMapChange: boolean }; response: SharedSettingsState };
    refreshCaptureDevices: { params: Record<string, never>; response: SharedSettingsState };
    openNpcapDownload: { params: Record<string, never>; response: void };
    setOverlayLocked: { params: { locked: boolean }; response: SharedSettingsState };
    setOverlayElementEnabled: { params: { id: OverlayElementId; enabled: boolean }; response: SharedSettingsState };
    setOverlayElementDisplay: { params: { id: OverlayElementId; display: string }; response: SharedSettingsState };
    setOverlayHomeDisplay: { params: { display: string }; response: SharedSettingsState };
    setOverlayVisible: { params: { visible: boolean }; response: SharedSettingsState };
    setAutoHideWhenUnfocused: { params: { enabled: boolean }; response: SharedSettingsState };
    setShortcut: { params: { action: KeybindAction; shortcut: string }; response: SharedSettingsState };
    resetShortcutsToDefaults: { params: Record<string, never>; response: SharedSettingsState };
    setShortcutCapture: { params: { active: boolean }; response: SharedSettingsState };
    setOverlayRequiredStatuses: {
      params: { category: RequiredStatusCategory; statusIds: string[] };
      response: SharedSettingsState;
    };
    setPersonalDpsMode: { params: { mode: PersonalDpsMode }; response: SharedSettingsState };
    setMinimapEnabled: { params: { enabled: boolean }; response: SharedSettingsState };
    setMinimapRarityFilter: { params: { rarity: number }; response: SharedSettingsState };
    setMinimapLootChanceFilter: { params: { chance: number }; response: SharedSettingsState };
    importSettings: { params: Record<string, never>; response: void };
    importSetting: { params: { kind: SettingsKind }; response: void };
    exportSetting: { params: { kind: SettingsKind }; response: void };
    openDataFolder: { params: Record<string, never>; response: void };
    resetSettings: { params: Record<string, never>; response: void };
    windowAction: { params: { action: "minimize" | "close" }; response: void };
    getWindowFrame: { params: Record<string, never>; response: WindowFrame };
    setWindowFrame: { params: WindowFrame; response: void };
  } }>;
  webview: RPCSchema<{ messages: { stateChanged: SharedSettingsState; showSection: SettingsSectionId } }>;
};
