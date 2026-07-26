import { signal } from "@preact/signals";
import { render } from "preact";
import { Electroview } from "electrobun/view";
import { TitleBar } from "@spiritvale/ui-core/title-bar";

import {
  OVERLAY_ELEMENT_IDS,
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
};
const state = signal<OverlayState | undefined>(undefined);
const recordingResetShortcut = signal(false);
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
          <p>Locked mode lets mouse clicks pass through to the game. Unlock to drag overlay elements. Press F11 at any time to toggle the lock.</p>
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
          <h2>Reset shortcut</h2>
          <p>Resets the capture session, including combat, rewards, and market data.</p>
          <button
            class="btn"
            type="button"
            onClick={() => { recordingResetShortcut.value = true; }}
            onKeyDown={(event) => void captureResetShortcut(event)}
          >
            {recordingResetShortcut.value ? "Press a shortcut…" : next.resetShortcut}
          </button>
          <p aria-live="polite">{next.resetShortcutError ?? (recordingResetShortcut.value
            ? "Press a key, optionally with Ctrl, Alt, Shift, or Meta. Press Escape to cancel."
            : "Click the shortcut to record a replacement.")}</p>
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

function captureResetShortcut(event: KeyboardEvent): Promise<void> {
  if (!recordingResetShortcut.value) return Promise.resolve();
  event.preventDefault();
  if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
    recordingResetShortcut.value = false;
    return Promise.resolve();
  }
  const shortcut = shortcutFromKeyboardEvent(event);
  if (!shortcut) return Promise.resolve();
  recordingResetShortcut.value = false;
  return electroview.rpc?.request.setResetShortcut({ shortcut }).then((next) => { state.value = next; }) ?? Promise.resolve();
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
