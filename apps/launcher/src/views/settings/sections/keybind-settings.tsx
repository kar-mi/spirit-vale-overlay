import { KEYBIND_ACTIONS, type KeybindAction } from "@svoverlay/overlay/app-types";
import type { SettingsSection, SettingsSectionContext } from "../settings-section.ts";

const KEYBIND_LABELS: Record<KeybindAction, string> = {
  toggleLock: "Lock/unlock overlay", resetSession: "Reset session",
  openLiveDeathLog: "Open live death log", toggleOverlayVisible: "Show/hide overlay",
  cycleMeterStatType: "Cycle party meter",
  resetXpTracker: "Reset all-time XP", resetGoldTracker: "Reset all-time gold",
  toggleMinimap: "Show/hide minimap",
};

export function buildKeybindSettingsSection({ state, busy, recordingAction, actions }: SettingsSectionContext): SettingsSection {
  const { overlay } = state;
  return {
    id: "keybinds",
    label: "Keybinds",
    description: "Global pass-through shortcuts remain active while Spirit Vale Overlay is running; the foreground app receives the same key press.",
    items: [
      {
        id: "keybind-focus",
        searchText: "Only enable keybinds while Spirit Vale game focused Escape edit mode recovery",
        content: <><label class="settings-check"><input type="checkbox" checked={overlay.keybindsRequireGameFocus} disabled={busy} onChange={(event) => actions.setKeybindsRequireGameFocus(event.currentTarget.checked)} /><span>Only enable keybinds while Spirit Vale is focused</span></label><p class="settings-hint">The fixed Escape shortcut for leaving overlay edit mode remains available as a recovery action.</p></>,
      },
      {
        id: "keybind-assignments",
        searchText: `Shortcut assignments reset defaults click select record key combination pass through ${Object.values(KEYBIND_LABELS).join(" ")}`,
        content: <><div class="settings-actions"><button class="btn" type="button" disabled={busy} onClick={actions.resetShortcuts}>Reset to defaults</button></div><section class="keybind-list" aria-label="Keybind assignments"><h2>Click to select</h2>{KEYBIND_ACTIONS.map((action) => <div class="keybind-row" key={action}>
          <span>{KEYBIND_LABELS[action]}</span>
          <button class="btn" type="button" onClick={() => actions.beginShortcutCapture(action)} onKeyDown={(event) => actions.captureShortcut(action, event)}>{recordingAction === action ? "Press a shortcut…" : overlay.shortcuts[action]}</button>
          {(overlay.shortcutErrors[action] || recordingAction === action) && <p class="keybind-message" aria-live="polite">{overlay.shortcutErrors[action] ?? "Press a key or Escape to cancel."}</p>}
        </div>)}</section><p class="settings-hint">Shortcuts pass through to the foreground app. Windows or another app may also use the same combination; Ctrl+Shift can switch input languages when configured that way in Windows.</p></>,
      },
    ],
  };
}
