import type { ComponentChildren } from "preact";
import type { KeybindAction, OverlayElementId, RequiredStatusCategory } from "@svoverlay/overlay/app-types";
import type { SharedSettingsState } from "../../launcher/types.ts";

export type SectionId = "general" | "network" | "overlay" | "combat" | "status" | "keybinds" | "minimap";

export interface SettingsItem {
  id: string;
  searchText: string;
  content: ComponentChildren;
}

export interface SettingsSection {
  id: SectionId;
  label: string;
  description: string;
  items: SettingsItem[];
}

export interface SettingsActions {
  setUiScale(value: SharedSettingsState["launcher"]["uiScale"]): void;
  setMinimizeToTray(value: boolean): void;
  setCaptureAdapter(value: string): void;
  refreshCaptureDevices(): void;
  openNpcapDownload(): void;
  setOverlayLocked(value: boolean): void;
  setOverlayVisible(value: boolean): void;
  setAutoHideWhenUnfocused(value: boolean): void;
  setOverlayHomeDisplay(value: string): void;
  setOverlayElementEnabled(id: OverlayElementId, enabled: boolean): void;
  setOverlayElementDisplay(id: OverlayElementId, display: string): void;
  setResetMeterOnMapChange(value: boolean): void;
  setResetGoldOnMapChange(value: boolean): void;
  setPersonalDpsMode(value: SharedSettingsState["overlay"]["personalDpsMode"]): void;
  setMinimapRarityFilter(value: number): void;
  setMinimapLootChanceFilter(value: number): void;
  setRequiredStatuses(category: RequiredStatusCategory, statusIds: string[]): void;
  resetShortcuts(): void;
  beginShortcutCapture(action: KeybindAction): void;
  captureShortcut(action: KeybindAction, event: KeyboardEvent): void;
}

export interface SettingsSectionContext {
  state: SharedSettingsState;
  busy: boolean;
  recordingAction?: KeybindAction;
  actions: SettingsActions;
}
