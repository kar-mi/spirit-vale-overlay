import { signal } from "@preact/signals";
import { render } from "preact";
import { useState } from "preact/hooks";
import { DesktopView } from "@svoverlay/desktop-runtime/view";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { disableWebChrome } from "@svoverlay/ui-kit/disable-web-chrome";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";
import { TitleBar } from "@svoverlay/ui-kit/title-bar";
import type { KeybindAction } from "@svoverlay/overlay/app-types";
import { useTranslator } from "@svoverlay/i18n/browser";
import type { LauncherSettingsRpc, SharedSettingsState } from "../../launcher/types.ts";
import { SettingsLayout, type SectionRequest } from "./settings-layout.tsx";
import type { SettingsActions, SettingsSectionContext } from "./settings-section.ts";
import { buildBasicSettingsSections } from "./sections/basic-settings.tsx";
import { buildKeybindSettingsSection } from "./sections/keybind-settings.tsx";
import { buildLanguageSettingsSection } from "./sections/language-settings.tsx";
import { buildManageSettingsSection } from "./sections/manage-settings.tsx";
import { buildMinimapSettingsSection } from "./sections/minimap-settings.tsx";
import { buildOverlaySettingsSection } from "./sections/overlay-settings.tsx";
import { buildStatusSettingsSection } from "./sections/status-settings.tsx";
import { shortcutFromKeyboardEvent } from "./shortcut-from-keyboard-event.ts";

const state = signal<SharedSettingsState | undefined>(undefined);
const recordingAction = signal<KeybindAction | undefined>(undefined);
const requestedSection = signal<SectionRequest | undefined>(undefined);
let sectionRequestToken = 0;
const rpc = DesktopView.defineRPC<LauncherSettingsRpc>({
  handlers: {
    requests: {},
    messages: {
      stateChanged: (next) => { state.value = repairRendererPayload(next); },
      showSection: (id) => { requestedSection.value = { id, token: ++sectionRequestToken }; },
    },
  },
});
const desktopView = new DesktopView({ rpc });
void desktopView.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });

const SETTINGS_DEFAULT_WIDTH = 798;
const SETTINGS_DEFAULT_HEIGHT = 680;
disableWebChrome();
void ensureInitialWindowSize(desktopView.rpc?.request, { width: 560, height: 420 });

function App() {
  const [busy, setBusy] = useState(false);
  const next = state.value;
  // Reads `activeLocale`, so a language push re-renders this window. `setActiveLocale` owns
  // `document.documentElement.lang`, which every index.html ships as `en`.
  const t = useTranslator();
  if (!next) return <main class="app-shell" />;

  const update = (request: Promise<SharedSettingsState> | undefined): void => {
    if (!request) return;
    setBusy(true);
    void request.then((updated) => { state.value = repairRendererPayload(updated); }).finally(() => setBusy(false));
  };

  const actions: SettingsActions = {
    setUiScale: (uiScale) => update(desktopView.rpc?.request.setUiScale({ uiScale })),
    setLanguage: (language) => update(desktopView.rpc?.request.setLanguage({ language })),
    setMinimizeToTray: (minimizeToTray) => update(desktopView.rpc?.request.setMinimizeToTray({ minimizeToTray })),
    setCaptureAdapter: (value) => update(desktopView.rpc?.request.setCaptureAdapter({ deviceName: value === "auto" ? null : value })),
    refreshCaptureDevices: () => update(desktopView.rpc?.request.refreshCaptureDevices({})),
    openNpcapDownload: () => { void desktopView.rpc?.request.openNpcapDownload({}); },
    setOverlayLocked: (locked) => update(desktopView.rpc?.request.setOverlayLocked({ locked })),
    setOverlayVisible: (visible) => update(desktopView.rpc?.request.setOverlayVisible({ visible })),
    setAutoHideWhenUnfocused: (enabled) => update(desktopView.rpc?.request.setAutoHideWhenUnfocused({ enabled })),
    setOverlayHomeDisplay: (display) => update(desktopView.rpc?.request.setOverlayHomeDisplay({ display })),
    setOverlayElementEnabled: (id, enabled) => update(desktopView.rpc?.request.setOverlayElementEnabled({ id, enabled })),
    setOverlayElementDisplay: (id, display) => update(desktopView.rpc?.request.setOverlayElementDisplay({ id, display })),
    setResetMeterOnMapChange: (resetMeterOnMapChange) => update(desktopView.rpc?.request.setResetMeterOnMapChange({ resetMeterOnMapChange })),
    setResetGoldOnMapChange: (resetGoldOnMapChange) => update(desktopView.rpc?.request.setResetGoldOnMapChange({ resetGoldOnMapChange })),
    setPastLogLimit: (pastLogLimit) => update(desktopView.rpc?.request.setPastLogLimit({ pastLogLimit })),
    setPersonalDpsMode: (mode) => update(desktopView.rpc?.request.setPersonalDpsMode({ mode })),
    setMinimapEnabled: (enabled) => update(desktopView.rpc?.request.setMinimapEnabled({ enabled })),
    setMinimapRarityFilter: (rarity) => update(desktopView.rpc?.request.setMinimapRarityFilter({ rarity })),
    setMinimapLootChanceFilter: (chance) => update(desktopView.rpc?.request.setMinimapLootChanceFilter({ chance })),
    importSettings: () => { void desktopView.rpc?.request.importSettings({}); },
    importSetting: (kind) => { void desktopView.rpc?.request.importSetting({ kind }); },
    exportSetting: (kind) => { void desktopView.rpc?.request.exportSetting({ kind }); },
    openDataFolder: () => { void desktopView.rpc?.request.openDataFolder({}); },
    resetSettings: () => { void desktopView.rpc?.request.resetSettings({}); },
    setRequiredStatuses: (category, statusIds) => update(desktopView.rpc?.request.setOverlayRequiredStatuses({ category, statusIds })),
    resetShortcuts: () => {
      recordingAction.value = undefined;
      update(desktopView.rpc?.request.resetShortcutsToDefaults({}));
    },
    beginShortcutCapture: (action) => { void beginShortcutCapture(action); },
    captureShortcut: (action, event) => { void captureShortcut(action, event); },
  };
  const context: SettingsSectionContext = { state: next, t, busy, recordingAction: recordingAction.value, actions };
  const basicSections = buildBasicSettingsSections(context);
  const sections = [
    basicSections[0]!,
    buildLanguageSettingsSection(context),
    basicSections[1]!,
    buildOverlaySettingsSection(context),
    basicSections[2]!,
    buildStatusSettingsSection(context),
    buildMinimapSettingsSection(context),
    buildKeybindSettingsSection(context),
    buildManageSettingsSection(context),
  ];

  return <main class="app-shell">
    <TitleBar
      appTag={t("settings.window.tag")}
      minWidth={560}
      minHeight={420}
      getFrame={async () => (await desktopView.rpc?.request.getWindowFrame({})) ?? { x: 110, y: 110, width: SETTINGS_DEFAULT_WIDTH, height: SETTINGS_DEFAULT_HEIGHT }}
      setFrame={(frame) => void desktopView.rpc?.request.setWindowFrame(frame)}
      onMinimize={() => void desktopView.rpc?.request.windowAction({ action: "minimize" })}
      onClose={() => void desktopView.rpc?.request.windowAction({ action: "close" })}
    />
    <section class="settings-content">
      {(next.launcher.storageWarning || next.overlay.shortcutErrors.openLiveDeathLog) && <div class="banner is-warn" aria-live="polite">{t.text(next.launcher.storageWarning) ?? next.overlay.shortcutErrors.openLiveDeathLog}</div>}
      <SettingsLayout sections={sections} t={t} requestedSection={requestedSection.value} />
    </section>
  </main>;
}

function beginShortcutCapture(action: KeybindAction): Promise<void> {
  return desktopView.rpc?.request.setShortcutCapture({ active: true }).then((next) => {
    state.value = repairRendererPayload(next);
    recordingAction.value = action;
  }) ?? Promise.resolve();
}

function captureShortcut(action: KeybindAction, event: KeyboardEvent): Promise<void> {
  if (recordingAction.value !== action) return Promise.resolve();
  event.preventDefault();
  if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
    recordingAction.value = undefined;
    return desktopView.rpc?.request.setShortcutCapture({ active: false }).then((next) => { state.value = repairRendererPayload(next); }) ?? Promise.resolve();
  }
  const shortcut = shortcutFromKeyboardEvent(event);
  if (!shortcut) return Promise.resolve();
  recordingAction.value = undefined;
  return desktopView.rpc?.request.setShortcut({ action, shortcut }).then((next) => { state.value = repairRendererPayload(next); }) ?? Promise.resolve();
}

render(<App />, document.getElementById("root")!);
