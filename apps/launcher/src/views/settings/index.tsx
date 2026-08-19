import { signal } from "@preact/signals";
import { render } from "preact";
import { useState } from "preact/hooks";
import { Electroview } from "electrobun/view";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";
import { TitleBar } from "@svoverlay/ui-kit/title-bar";
import type { KeybindAction } from "@svoverlay/overlay/app-types";
import type { LauncherSettingsRpc, SharedSettingsState } from "../../launcher/types.ts";
import { SettingsLayout } from "./settings-layout.tsx";
import type { SettingsActions, SettingsSectionContext } from "./settings-section.ts";
import { buildBasicSettingsSections } from "./sections/basic-settings.tsx";
import { buildKeybindSettingsSection } from "./sections/keybind-settings.tsx";
import { buildMinimapSettingsSection } from "./sections/minimap-settings.tsx";
import { buildOverlaySettingsSection } from "./sections/overlay-settings.tsx";
import { buildStatusSettingsSection } from "./sections/status-settings.tsx";
import { shortcutFromKeyboardEvent } from "./shortcut-from-keyboard-event.ts";

const state = signal<SharedSettingsState | undefined>(undefined);
const recordingAction = signal<KeybindAction | undefined>(undefined);
const rpc = Electroview.defineRPC<LauncherSettingsRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = repairRendererPayload(next); } } },
});
const electroview = new Electroview({ rpc });
void electroview.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });

const SETTINGS_DEFAULT_WIDTH = 798;
const SETTINGS_DEFAULT_HEIGHT = 680;
void ensureInitialWindowSize(electroview.rpc?.request, { width: 560, height: 420 });

function App() {
  const [busy, setBusy] = useState(false);
  const next = state.value;
  if (!next) return <main class="app-shell" />;

  const update = (request: Promise<SharedSettingsState> | undefined): void => {
    if (!request) return;
    setBusy(true);
    void request.then((updated) => { state.value = repairRendererPayload(updated); }).finally(() => setBusy(false));
  };

  const actions: SettingsActions = {
    setUiScale: (uiScale) => update(electroview.rpc?.request.setUiScale({ uiScale })),
    setMinimizeToTray: (minimizeToTray) => update(electroview.rpc?.request.setMinimizeToTray({ minimizeToTray })),
    setCaptureAdapter: (value) => update(electroview.rpc?.request.setCaptureAdapter({ deviceName: value === "auto" ? null : value })),
    refreshCaptureDevices: () => update(electroview.rpc?.request.refreshCaptureDevices({})),
    openNpcapDownload: () => { void electroview.rpc?.request.openNpcapDownload({}); },
    setOverlayLocked: (locked) => update(electroview.rpc?.request.setOverlayLocked({ locked })),
    setOverlayVisible: (visible) => update(electroview.rpc?.request.setOverlayVisible({ visible })),
    setAutoHideWhenUnfocused: (enabled) => update(electroview.rpc?.request.setAutoHideWhenUnfocused({ enabled })),
    setOverlayHomeDisplay: (display) => update(electroview.rpc?.request.setOverlayHomeDisplay({ display })),
    setOverlayElementEnabled: (id, enabled) => update(electroview.rpc?.request.setOverlayElementEnabled({ id, enabled })),
    setOverlayElementDisplay: (id, display) => update(electroview.rpc?.request.setOverlayElementDisplay({ id, display })),
    setResetMeterOnMapChange: (resetMeterOnMapChange) => update(electroview.rpc?.request.setResetMeterOnMapChange({ resetMeterOnMapChange })),
    setResetGoldOnMapChange: (resetGoldOnMapChange) => update(electroview.rpc?.request.setResetGoldOnMapChange({ resetGoldOnMapChange })),
    setPersonalDpsMode: (mode) => update(electroview.rpc?.request.setPersonalDpsMode({ mode })),
    setMinimapRarityFilter: (rarity) => update(electroview.rpc?.request.setMinimapRarityFilter({ rarity })),
    setRequiredStatuses: (category, statusIds) => update(electroview.rpc?.request.setOverlayRequiredStatuses({ category, statusIds })),
    setKeybindsRequireGameFocus: (enabled) => update(electroview.rpc?.request.setKeybindsRequireGameFocus({ enabled })),
    resetShortcuts: () => {
      recordingAction.value = undefined;
      update(electroview.rpc?.request.resetShortcutsToDefaults({}));
    },
    beginShortcutCapture: (action) => { void beginShortcutCapture(action); },
    captureShortcut: (action, event) => { void captureShortcut(action, event); },
  };
  const context: SettingsSectionContext = { state: next, busy, recordingAction: recordingAction.value, actions };
  const basicSections = buildBasicSettingsSections(context);
  const sections = [
    ...basicSections.slice(0, 2),
    buildOverlaySettingsSection(context),
    basicSections[2]!,
    buildStatusSettingsSection(context),
    buildMinimapSettingsSection(context),
    buildKeybindSettingsSection(context),
  ];

  return <main class="app-shell">
    <TitleBar
      appTag="Settings"
      minWidth={560}
      minHeight={420}
      getFrame={async () => (await electroview.rpc?.request.getWindowFrame({})) ?? { x: 110, y: 110, width: SETTINGS_DEFAULT_WIDTH, height: SETTINGS_DEFAULT_HEIGHT }}
      setFrame={(frame) => void electroview.rpc?.request.setWindowFrame(frame)}
      onMinimize={() => void electroview.rpc?.request.windowAction({ action: "minimize" })}
      onClose={() => void electroview.rpc?.request.windowAction({ action: "close" })}
    />
    <section class="settings-content">
      {(next.launcher.storageWarning || next.overlay.shortcutErrors.openLiveDeathLog) && <div class="banner is-warn" aria-live="polite">{next.launcher.storageWarning ?? next.overlay.shortcutErrors.openLiveDeathLog}</div>}
      <SettingsLayout sections={sections} />
    </section>
  </main>;
}

function beginShortcutCapture(action: KeybindAction): Promise<void> {
  return electroview.rpc?.request.setShortcutCapture({ active: true }).then((next) => {
    state.value = repairRendererPayload(next);
    recordingAction.value = action;
  }) ?? Promise.resolve();
}

function captureShortcut(action: KeybindAction, event: KeyboardEvent): Promise<void> {
  if (recordingAction.value !== action) return Promise.resolve();
  event.preventDefault();
  if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
    recordingAction.value = undefined;
    return electroview.rpc?.request.setShortcutCapture({ active: false }).then((next) => { state.value = repairRendererPayload(next); }) ?? Promise.resolve();
  }
  const shortcut = shortcutFromKeyboardEvent(event);
  if (!shortcut) return Promise.resolve();
  recordingAction.value = undefined;
  return electroview.rpc?.request.setShortcut({ action, shortcut }).then((next) => { state.value = repairRendererPayload(next); }) ?? Promise.resolve();
}

render(<App />, document.getElementById("root")!);
