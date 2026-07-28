import { signal } from "@preact/signals";
import { render } from "preact";
import { Electroview } from "electrobun/view";
import { TitleBar } from "@spiritvale/ui-core/title-bar";

import {
  KEYBIND_ACTIONS,
  OVERLAY_ELEMENT_IDS,
  type KeybindAction,
  type OverlayElementId,
  type OverlaySettingsRpc,
  type OverlayState,
} from "../app-types.ts";

const LABELS: Record<OverlayElementId, string> = {
  dpsChart: "DPS chart",
  personalDps: "Personal DPS numbers",
  partyRanking: "Party DPS ranking",
  health: "HP bar",
  mana: "MP bar",
  weight: "Weight",
  buffs: "Buffs",
  debuffs: "Debuffs",
  toggles: "Toggles (no timer)",
};
const KEYBIND_LABELS: Record<KeybindAction, string> = {
  toggleLock: "Lock/unlock overlay",
  resetSession: "Reset session",
  toggleOverlayVisible: "Show/hide overlay",
  cycleMeterStatType: "Cycle party meter",
};
const KEYBIND_DESCRIPTIONS: Record<KeybindAction, string> = {
  toggleLock: "Toggle edit mode to drag overlay elements.",
  resetSession: "Resets the capture session, including combat, rewards, and market data.",
  toggleOverlayVisible: "Fully shows or hides the overlay. This does not persist across restarts.",
  cycleMeterStatType: "Switches the party/map meter between damage (DPS), healing (HPS), and damage taken (TPS).",
};
const state = signal<OverlayState | undefined>(undefined);
const recordingAction = signal<KeybindAction | undefined>(undefined);
const rpc = Electroview.defineRPC<OverlaySettingsRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = next; } } },
});
const electroview = new Electroview({ rpc });
void electroview.rpc?.request.getState({}).then((next) => { state.value = next; });

function App() {
  const next = state.value;
  if (!next) return <main class="app-shell" />;
  return (
    <main class="app-shell">
      <TitleBar
        appTag="Overlay Settings"
        minWidth={560}
        minHeight={420}
        getFrame={async () => (await electroview.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: 560, height: 420 }}
        setFrame={(frame) => void electroview.rpc?.request.setWindowFrame(frame)}
        onMinimize={() => void electroview.rpc?.request.windowAction({ action: "minimize" })}
        onClose={() => void electroview.rpc?.request.windowAction({ action: "close" })}
      />
      <section class="settings-content">
        <section class="settings-section">
          <div class="toggle-row">
            <span><strong>{next.locked ? "Overlay locked" : "Edit mode"}</strong></span>
            <button class="btn" type="button" onClick={() => void updateLock(!next.locked)}>
              {next.locked ? "Unlock overlay" : "Lock overlay"}
            </button>
          </div>
          <p>Locked mode lets mouse clicks pass through to the game. Unlock to drag overlay elements. Press {next.shortcuts.toggleLock} at any time to toggle the lock.</p>
          <p>
            Known limitation: on borderless-fullscreen games, having the overlay window on
            screen can cause a very slight, unavoidable blur in the game's own rendering.
            Windows normally presents a fullscreen-covering game directly to the display
            (a fast path called Independent Flip); any overlapping window, including this
            fully click-through overlay, disqualifies that fast path and forces Windows to
            composite the frame instead, which introduces the softness. This is a Windows
            display-compositing behavior triggered by any on-screen overlay tool, not
            something this app can fix from a separate window.
          </p>
        </section>
        <section class="settings-section">
          <h2>Show/hide overlay</h2>
          <div class="toggle-row">
            <span><strong>{next.overlayVisible ? "Overlay shown" : "Overlay hidden"}</strong></span>
            <button class="btn" type="button" onClick={() => void setOverlayVisible(!next.overlayVisible)}>
              {next.overlayVisible ? "Hide overlay" : "Show overlay"}
            </button>
          </div>
          <p>Fully shows or hides the overlay. This does not persist across restarts.</p>
        </section>
        <section class="settings-section">
          <h2>Keybinds</h2>
          {KEYBIND_ACTIONS.map((action) => (
            <div key={action}>
              <div class="toggle-row">
                <span><strong>{KEYBIND_LABELS[action]}</strong></span>
                <button
                  class="btn"
                  type="button"
                  onClick={() => { recordingAction.value = action; }}
                  onKeyDown={(event) => void captureShortcut(action, event)}
                >
                  {recordingAction.value === action ? "Press a shortcut…" : next.shortcuts[action]}
                </button>
              </div>
              <p>{KEYBIND_DESCRIPTIONS[action]}</p>
              <p aria-live="polite">{next.shortcutErrors[action] ?? (recordingAction.value === action
                ? "Press a key, optionally with Ctrl, Alt, Shift, or Meta. Press Escape to cancel."
                : "Click the shortcut to record a replacement.")}</p>
            </div>
          ))}
        </section>
        <section class="settings-section">
          <h2>Visible elements</h2>
          {OVERLAY_ELEMENT_IDS.map((id) => (
            <label class="toggle-row" key={id}>
              <span>{LABELS[id]}</span>
              <input
                type="checkbox"
                checked={next.elements[id].enabled}
                onChange={(event) => void setEnabled(id, event.currentTarget.checked)}
              />
            </label>
          ))}
        </section>
        <section class="settings-section">
          <h2>Personal character</h2>
          <p>{next.personalName
            ? <>Detected automatically: <strong>{next.personalName}</strong></>
            : "Waiting to detect your active character."}</p>
        </section>
        <div class="actions">
          <button class="btn danger" type="button" onClick={() => void electroview.rpc?.request.closeOverlay({})}>Close overlay</button>
        </div>
      </section>
    </main>
  );
}

function updateLock(locked: boolean): Promise<void> {
  return electroview.rpc?.request.setLocked({ locked }).then((next) => { state.value = next; }) ?? Promise.resolve();
}

function setEnabled(id: OverlayElementId, enabled: boolean): Promise<void> {
  return electroview.rpc?.request.setElementEnabled({ id, enabled }).then((next) => { state.value = next; }) ?? Promise.resolve();
}

function setOverlayVisible(visible: boolean): Promise<void> {
  return electroview.rpc?.request.setOverlayVisible({ visible }).then((next) => { state.value = next; }) ?? Promise.resolve();
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
  return electroview.rpc?.request.setShortcut({ action, shortcut }).then((next) => { state.value = next; }) ?? Promise.resolve();
}

function shortcutFromKeyboardEvent(event: KeyboardEvent): string | undefined {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return undefined;
  const specialKeys: Record<string, string> = {
    " ": "Space",
    Enter: "Enter",
    Escape: "Escape",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
  };
  const key = /^F(?:[1-9]|1[0-9]|2[0-4])$/i.test(event.key)
    ? event.key.toUpperCase()
    : /^[a-z0-9]$/i.test(event.key)
      ? event.key.toUpperCase()
      : specialKeys[event.key];
  if (!key) return undefined;
  return [
    ...(event.ctrlKey ? ["Ctrl"] : []),
    ...(event.altKey ? ["Alt"] : []),
    ...(event.shiftKey ? ["Shift"] : []),
    ...(event.metaKey ? ["Meta"] : []),
    key,
  ].join("+");
}

render(<App />, document.getElementById("root")!);
