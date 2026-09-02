import { useEffect, useRef, useState } from "preact/hooks";
import type { MessageKey } from "@svoverlay/i18n/messages";
import type { Translator } from "@svoverlay/i18n/translate";
import type { SettingsSection, SettingsSectionContext } from "../settings-section.ts";
import type { SettingsKind } from "../../../desktop/manage-settings.ts";

const SETTINGS_KIND_LABEL_KEYS: ReadonlyArray<{ kind: SettingsKind; key: MessageKey }> = [
  { kind: "launcher", key: "settingsKind.launcher" },
  { kind: "overlay", key: "settingsKind.overlay" },
  { kind: "dps", key: "settingsKind.dps" },
  { kind: "rewards", key: "settingsKind.rewards" },
  { kind: "windowLayout", key: "settingsKind.windowLayout" },
];

export function buildManageSettingsSection({ state, actions, t }: SettingsSectionContext): SettingsSection {
  const kindRows = SETTINGS_KIND_LABEL_KEYS.map(({ kind, key }) => ({ kind, label: t(key) }));
  return {
    id: "manage",
    label: t("settings.manage.label"),
    description: t("settings.manage.description"),
    items: [
      {
        id: "settings-folder",
        searchText: t("settings.manage.folder.search"),
        content: <>
          <div class="banner is-error" role="note" aria-label={t("settings.manage.folder.warningLabel")}>
            {t("settings.manage.folder.warning")}
          </div>
          <div class="settings-field">
            <span>{t("settings.manage.folder.label")}</span>
            <p class="data-folder-path" title={state.dataFolder}>{state.dataFolder}</p>
          </div>
          <div class="manage-settings-actions">
            <button class="btn" type="button" onClick={actions.importSettings}>{t("settings.manage.folder.import")}</button>
            <button class="btn" type="button" onClick={actions.openDataFolder}>{t("settings.manage.folder.open")}</button>
          </div>
          <p class="settings-hint">{t("settings.manage.folder.hint")}</p>
        </>,
      },
      {
        id: "settings-files",
        searchText: `${t("settings.manage.files.search")} ${kindRows.map((row) => row.label).join(" ")}`,
        content: <>
          {kindRows.map(({ kind, label }) => <div class="settings-row" key={kind}>
            <span>{label}</span>
            <span class="settings-actions">
              <button class="btn" type="button" onClick={() => actions.importSetting(kind)}>{t("settings.manage.files.import")}</button>
              <button class="btn" type="button" onClick={() => actions.exportSetting(kind)}>{t("settings.manage.files.export")}</button>
            </span>
          </div>)}
        </>,
      },
      {
        id: "reset-settings",
        searchText: t("settings.manage.reset.search"),
        content: <ResetAllSettings onReset={actions.resetSettings} t={t} />,
      },
    ],
  };
}

function ResetAllSettings({ onReset, t }: { onReset: () => void; t: Translator }) {
  const [promptOpen, setPromptOpen] = useState(false);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (promptOpen) cancelButtonRef.current?.focus(); }, [promptOpen]);

  const cancel = (): void => { setPromptOpen(false); };
  return <>
    <div class="manage-settings-actions">
      <button class="btn" type="button" onClick={() => setPromptOpen(true)}>{t("settings.manage.reset.open")}</button>
    </div>
    {promptOpen ? <div class="modal-layer" role="presentation">
      <form class="modal-card reset-modal" role="dialog" aria-modal="true" aria-labelledby="reset-title" onSubmit={(event) => {
        event.preventDefault();
        setPromptOpen(false);
        onReset();
      }} onKeyDown={(event) => {
        if (event.key === "Escape") cancel();
      }}>
        <div class="modal-head"><div><h2 id="reset-title">{t("settings.manage.reset.title")}</h2><p>{t("settings.manage.reset.body")}</p></div><button class="modal-close" type="button" aria-label={t("settings.manage.reset.cancel")} onClick={cancel}>×</button></div>
        <div class="modal-actions"><button ref={cancelButtonRef} class="btn" type="button" onClick={cancel}>{t("settings.manage.reset.cancel")}</button><button class="btn reset-button" type="submit">{t("settings.manage.reset.confirm")}</button></div>
      </form>
    </div> : null}
  </>;
}
