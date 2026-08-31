import { useEffect, useRef, useState } from "preact/hooks";
import type { SettingsSection, SettingsSectionContext } from "../settings-section.ts";
import type { SettingsKind } from "../../../desktop/manage-settings.ts";

const SETTINGS_KIND_ROWS: ReadonlyArray<{ kind: SettingsKind; label: string }> = [
  { kind: "launcher", label: "Launcher" },
  { kind: "overlay", label: "Overlay" },
  { kind: "dps", label: "Combat (DPS)" },
  { kind: "rewards", label: "Rewards" },
  { kind: "windowLayout", label: "Window Layout" },
];

export function buildManageSettingsSection({ state, actions }: SettingsSectionContext): SettingsSection {
  return {
    id: "manage",
    label: "Manage Settings",
    description: "Import, export, or reset your settings.",
    items: [
      {
        id: "settings-folder",
        searchText: "Settings folder data location path open explorer import all settings edit json while app open not saved overwritten",
        content: <>
          <div class="banner is-error" role="note" aria-label="Warning">
            Do not edit JSON settings while the app is open; those changes will not be saved. Use the Settings window, or close the app before editing the settings files.
          </div>
          <div class="settings-field">
            <span>Settings folder</span>
            <p class="data-folder-path" title={state.dataFolder}>{state.dataFolder}</p>
          </div>
          <div class="manage-settings-actions">
            <button class="btn" type="button" onClick={actions.importSettings}>Import Settings…</button>
            <button class="btn" type="button" onClick={actions.openDataFolder}>Open Settings Folder</button>
          </div>
          <p class="settings-hint">Importing settings from another folder closes Spirit Vale Overlay so the new settings load on the next start.</p>
        </>,
      },
      {
        id: "settings-files",
        searchText: `Import export settings file json backup restore ${SETTINGS_KIND_ROWS.map((row) => row.label).join(" ")}`,
        content: <>
          {SETTINGS_KIND_ROWS.map(({ kind, label }) => <div class="settings-row" key={kind}>
            <span>{label}</span>
            <span class="settings-actions">
              <button class="btn" type="button" onClick={() => actions.importSetting(kind)}>Import…</button>
              <button class="btn" type="button" onClick={() => actions.exportSetting(kind)}>Export…</button>
            </span>
          </div>)}
        </>,
      },
      {
        id: "reset-settings",
        searchText: "Reset all settings defaults erase restore factory",
        content: <ResetAllSettings onReset={actions.resetSettings} />,
      },
    ],
  };
}

function ResetAllSettings({ onReset }: { onReset: () => void }) {
  const [promptOpen, setPromptOpen] = useState(false);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (promptOpen) cancelButtonRef.current?.focus(); }, [promptOpen]);

  const cancel = (): void => { setPromptOpen(false); };
  return <>
    <div class="manage-settings-actions">
      <button class="btn" type="button" onClick={() => setPromptOpen(true)}>Reset All Settings…</button>
    </div>
    {promptOpen ? <div class="modal-layer" role="presentation">
      <form class="modal-card reset-modal" role="dialog" aria-modal="true" aria-labelledby="reset-title" onSubmit={(event) => {
        event.preventDefault();
        setPromptOpen(false);
        onReset();
      }} onKeyDown={(event) => {
        if (event.key === "Escape") cancel();
      }}>
        <div class="modal-head"><div><h2 id="reset-title">Reset all settings?</h2><p>Reset all settings to their defaults? This cannot be undone.</p></div><button class="modal-close" type="button" aria-label="Cancel" onClick={cancel}>×</button></div>
        <div class="modal-actions"><button ref={cancelButtonRef} class="btn" type="button" onClick={cancel}>Cancel</button><button class="btn reset-button" type="submit">Reset</button></div>
      </form>
    </div> : null}
  </>;
}
