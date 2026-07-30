import { signal } from "@preact/signals";
import { render } from "preact";
import { useState } from "preact/hooks";
import { Electroview } from "electrobun/view";
import { TitleBar } from "@spiritvale/ui-core/title-bar";
import { CustomSelect } from "@spiritvale/ui-core/custom-select";
import { UI_SCALE_VALUES } from "@spiritvale/ui-core/ui-scale";
import { repairRendererPayload } from "@spiritvale/ui-core/renderer-text";
import {
  KEYBIND_ACTIONS,
  OVERLAY_ELEMENT_IDS,
  type KeybindAction,
  type OverlayElementId,
} from "@spiritvale/overlay/app-types";
import type { LauncherSettingsRpc, SharedSettingsState } from "../launcher-types.ts";

type Tab = "general" | "network" | "overlay" | "keybinds";
const state = signal<SharedSettingsState | undefined>(undefined);
const recordingAction = signal<KeybindAction | undefined>(undefined);
const rpc = Electroview.defineRPC<LauncherSettingsRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = repairRendererPayload(next); } } },
});
const electroview = new Electroview({ rpc });
void electroview.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });

const UI_SCALE_OPTIONS = UI_SCALE_VALUES.map((value) => ({ value: String(value), label: `${Math.round(value * 100)}%` }));
const ELEMENT_LABELS: Record<OverlayElementId, string> = {
  dpsChart: "DPS chart", personalDps: "Personal DPS numbers", partyRanking: "Party DPS ranking",
  health: "HP bar", mana: "MP bar", weight: "Weight", buffs: "Buffs",
  debuffs: "Debuffs", toggles: "Toggles (no timer)",
};
const KEYBIND_LABELS: Record<KeybindAction, string> = {
  toggleLock: "Lock/unlock overlay", resetSession: "Reset session",
  openLiveDeathLog: "Open live death log", toggleOverlayVisible: "Show/hide overlay",
  cycleMeterStatType: "Cycle party meter",
};

function App() {
  const [tab, setTab] = useState<Tab>("general");
  const [busy, setBusy] = useState(false);
  const next = state.value;
  if (!next) return <main class="app-shell" />;
  const { launcher, overlay } = next;
  const adapterOptions = [
    { value: "auto", label: "Automatic (default route)" },
    ...launcher.adapters.map((adapter) => ({ value: adapter.id, label: adapter.label })),
    ...(launcher.selectedAdapter !== "auto" && !launcher.adapters.some((adapter) => adapter.id === launcher.selectedAdapter)
      ? [{ value: launcher.selectedAdapter, label: "Saved adapter (currently unavailable)" }] : []),
  ];

  const update = (request: Promise<SharedSettingsState> | undefined): void => {
    if (!request) return;
    setBusy(true);
    void request.then((updated) => { state.value = repairRendererPayload(updated); }).finally(() => setBusy(false));
  };

  return <main class="app-shell">
    <TitleBar
      appTag="Settings"
      minWidth={560}
      minHeight={420}
      getFrame={async () => (await electroview.rpc?.request.getWindowFrame({})) ?? { x: 110, y: 110, width: 798, height: 680 }}
      setFrame={(frame) => void electroview.rpc?.request.setWindowFrame(frame)}
      onMinimize={() => void electroview.rpc?.request.windowAction({ action: "minimize" })}
      onClose={() => void electroview.rpc?.request.windowAction({ action: "close" })}
    />
    <section class="settings-content">
      {(launcher.storageWarning || overlay.shortcutErrors.openLiveDeathLog) && <div class="banner is-warn" aria-live="polite">{launcher.storageWarning ?? overlay.shortcutErrors.openLiveDeathLog}</div>}
      <div class="settings-tabs" role="tablist" aria-label="Settings sections">
        {(["general", "network", "overlay", "keybinds"] as const).map((id) =>
          <button class={tab === id ? "settings-tab is-active" : "settings-tab"} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {id[0]!.toUpperCase() + id.slice(1)}
          </button>)}
      </div>

      <section class="settings-panel" hidden={tab !== "general"}>
        <header class="settings-heading"><h1>General</h1><p>Configure application behavior and appearance.</p></header>
        <label class="settings-field"><span>Interface scale</span><CustomSelect ariaLabel="Interface scale" disabled={busy} value={String(launcher.uiScale)} options={UI_SCALE_OPTIONS} onChange={(value) => update(electroview.rpc?.request.setUiScale({ uiScale: Number(value) as typeof launcher.uiScale }))} /></label>
        <label class="settings-check"><input type="checkbox" checked={launcher.minimizeToTray} disabled={busy} onChange={(event) => update(electroview.rpc?.request.setMinimizeToTray({ minimizeToTray: event.currentTarget.checked }))} /><span>Minimize launcher to tray</span></label>
      </section>

      <section class="settings-panel" hidden={tab !== "network"}>
        <header class="settings-heading"><h1>Network</h1><p>Npcap capture configuration.</p></header>
        <div class="settings-row"><span>Status</span><strong>{launcher.npcapAvailability}</strong></div>
        <p class="settings-hint">{launcher.npcapVersion ? `${launcher.npcapDetail} · ${launcher.npcapVersion}` : launcher.npcapDetail}</p>
        <label class="settings-field"><span>Network adapter</span><CustomSelect ariaLabel="Network adapter" disabled={busy || launcher.npcapAvailability !== "ready"} value={launcher.selectedAdapter} options={adapterOptions} onChange={(value) => update(electroview.rpc?.request.setCaptureAdapter({ deviceName: value === "auto" ? null : value }))} /></label>
        <div class="settings-actions"><button class="btn" type="button" onClick={() => update(electroview.rpc?.request.refreshCaptureDevices({}))}>Refresh</button>{launcher.npcapAvailability !== "ready" && <button class="btn primary" type="button" onClick={() => void electroview.rpc?.request.openNpcapDownload({})}>Get Npcap</button>}</div>
      </section>

      <section class="settings-panel" hidden={tab !== "overlay"}>
        <header class="settings-heading"><h1>Overlay</h1><p>Control overlay visibility and layout.</p></header>
        <div class="settings-card settings-row"><span><strong>{overlay.locked ? "Overlay locked" : "Edit mode"}</strong></span><button class="btn" type="button" onClick={() => update(electroview.rpc?.request.setOverlayLocked({ locked: !overlay.locked }))}>{overlay.locked ? "Unlock overlay" : "Lock overlay"}</button></div>
        <div class="settings-card settings-row"><span><strong>{overlay.overlayVisible ? "Overlay shown" : "Overlay hidden"}</strong></span><button class="btn" type="button" onClick={() => update(electroview.rpc?.request.setOverlayVisible({ visible: !overlay.overlayVisible }))}>{overlay.overlayVisible ? "Hide overlay" : "Show overlay"}</button></div>
        <div class="settings-card"><h2>Visible elements</h2>{OVERLAY_ELEMENT_IDS.map((id) => <label class="settings-check settings-element"><input type="checkbox" checked={overlay.elements[id].enabled} onChange={(event) => update(electroview.rpc?.request.setOverlayElementEnabled({ id, enabled: event.currentTarget.checked }))} /><span>{ELEMENT_LABELS[id]}</span></label>)}</div>
        <p class="settings-hint">{overlay.personalName ? `Detected character: ${overlay.personalName}` : "Waiting to detect your active character."}</p>
      </section>

      <section class="settings-panel" hidden={tab !== "keybinds"}>
        <header class="settings-heading"><h1>Keybinds</h1><p>Global shortcuts remain active while Spirit Vale is running.</p></header>
        {KEYBIND_ACTIONS.map((action) => <div class="settings-card">
          <div class="settings-row"><strong>{KEYBIND_LABELS[action]}</strong><button class="btn" type="button" onClick={() => { recordingAction.value = action; }} onKeyDown={(event) => void captureShortcut(action, event)}>{recordingAction.value === action ? "Press a shortcut…" : overlay.shortcuts[action]}</button></div>
          <p class="settings-hint">{overlay.shortcutErrors[action] ?? (recordingAction.value === action ? "Press a key or Escape to cancel." : "Click to record a replacement.")}</p>
        </div>)}
      </section>
    </section>
  </main>;
}

function captureShortcut(action: KeybindAction, event: KeyboardEvent): Promise<void> {
  if (recordingAction.value !== action) return Promise.resolve();
  event.preventDefault();
  if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
    recordingAction.value = undefined;
    return Promise.resolve();
  }
  const shortcut = shortcutFromKeyboardEvent(event);
  if (!shortcut) return Promise.resolve();
  recordingAction.value = undefined;
  return electroview.rpc?.request.setShortcut({ action, shortcut }).then((next) => { state.value = repairRendererPayload(next); }) ?? Promise.resolve();
}

function shortcutFromKeyboardEvent(event: KeyboardEvent): string | undefined {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return undefined;
  const special: Record<string, string> = { " ": "Space", Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight" };
  const key = /^F(?:[1-9]|1[0-9]|2[0-4])$/i.test(event.key) ? event.key.toUpperCase() : /^[a-z0-9]$/i.test(event.key) ? event.key.toUpperCase() : special[event.key];
  if (!key) return undefined;
  return [...(event.ctrlKey ? ["Ctrl"] : []), ...(event.altKey ? ["Alt"] : []), ...(event.shiftKey ? ["Shift"] : []), ...(event.metaKey ? ["Meta"] : []), key].join("+");
}

render(<App />, document.getElementById("root")!);
