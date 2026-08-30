import type { ComponentChildren } from "preact";
import type { LocaleCode } from "@svoverlay/i18n/locale";
import type { Translator } from "@svoverlay/i18n/translate";
import type { KeybindAction, OverlayElementId, RequiredStatusCategory } from "@svoverlay/overlay/app-types";
import type { SettingsSectionId, SharedSettingsState } from "../../launcher/types.ts";
import type { SettingsKind } from "../../desktop/manage-settings.ts";

export type SectionId = SettingsSectionId;

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
  setLanguage(value: LocaleCode): void;
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
  setMinimapEnabled(value: boolean): void;
  setMinimapRarityFilter(value: number): void;
  setMinimapLootChanceFilter(value: number): void;
  setRequiredStatuses(category: RequiredStatusCategory, statusIds: string[]): void;
  importSettings(): void;
  importSetting(kind: SettingsKind): void;
  exportSetting(kind: SettingsKind): void;
  openDataFolder(): void;
  resetSettings(): void;
  resetShortcuts(): void;
  beginShortcutCapture(action: KeybindAction): void;
  captureShortcut(action: KeybindAction, event: KeyboardEvent): void;
}

export interface SettingsSectionContext {
  state: SharedSettingsState;
  t: Translator;
  busy: boolean;
  recordingAction?: KeybindAction;
  actions: SettingsActions;
}
