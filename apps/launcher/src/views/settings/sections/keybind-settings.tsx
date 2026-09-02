import { KEYBIND_ACTIONS, type KeybindAction } from "@svoverlay/overlay/app-types";
import type { Translator } from "@svoverlay/i18n/translate";
import type { SettingsSection, SettingsSectionContext } from "../settings-section.ts";

const keybindLabel = (t: Translator, action: KeybindAction): string => t(`keybind.${action}`);

export function buildKeybindSettingsSection({ state, busy, recordingAction, actions, t }: SettingsSectionContext): SettingsSection {
  const { overlay } = state;
  return {
    id: "keybinds",
    label: t("settings.keybinds.label"),
    description: t("settings.keybinds.description"),
    items: [
      {
        id: "keybind-assignments",
        searchText: `${t("settings.keybinds.assignments.search")} ${KEYBIND_ACTIONS.map((action) => keybindLabel(t, action)).join(" ")}`,
        content: <><div class="settings-actions"><button class="btn" type="button" disabled={busy} onClick={actions.resetShortcuts}>{t("settings.keybinds.reset")}</button></div><section class="keybind-list" aria-label={t("settings.keybinds.list.label")}><h2>{t("settings.keybinds.list.heading")}</h2>{KEYBIND_ACTIONS.map((action) => <div class="keybind-row" key={action}>
          <span>{keybindLabel(t, action)}</span>
          <button class="btn" type="button" onClick={() => actions.beginShortcutCapture(action)} onKeyDown={(event) => actions.captureShortcut(action, event)}>{recordingAction === action ? t("settings.keybinds.recording") : overlay.shortcuts[action]}</button>
          {(overlay.shortcutErrors[action] || recordingAction === action) && <p class="keybind-message" aria-live="polite">{overlay.shortcutErrors[action] ?? t("settings.keybinds.recordingHint")}</p>}
        </div>)}</section><p class="settings-hint">{t("settings.keybinds.hint")}</p></>,
      },
    ],
  };
}
