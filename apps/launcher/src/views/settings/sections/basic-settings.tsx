import { UI_SCALE_VALUES } from "@svoverlay/desktop-platform/ui-scale";
import { CustomSelect } from "@svoverlay/ui-kit/custom-select";
import type { SettingsSection, SettingsSectionContext } from "../settings-section.ts";

const UI_SCALE_OPTIONS = UI_SCALE_VALUES.map((value) => ({ value: String(value), label: `${Math.round(value * 100)}%` }));
const PERSONAL_DPS_MODE_OPTIONS = [
  { value: "encounter", label: "Encounter average" },
  { value: "live", label: "Live (recent rate)" },
];

export function buildBasicSettingsSections({ state, busy, actions }: SettingsSectionContext): SettingsSection[] {
  const { launcher, overlay } = state;
  const adapterOptions = [
    { value: "auto", label: "Automatic (default route)" },
    ...launcher.adapters.map((adapter) => ({ value: adapter.id, label: adapter.label })),
    ...(launcher.selectedAdapter !== "auto" && !launcher.adapters.some((adapter) => adapter.id === launcher.selectedAdapter)
      ? [{ value: launcher.selectedAdapter, label: "Saved adapter (currently unavailable)" }] : []),
  ];

  return [
    {
      id: "general",
      label: "General",
      description: "Configure application behavior and appearance.",
      items: [
        {
          id: "interface-scale",
          searchText: "Interface scale UI appearance zoom percentage",
          content: <label class="settings-field"><span>Interface scale</span><CustomSelect ariaLabel="Interface scale" disabled={busy} value={String(launcher.uiScale)} options={UI_SCALE_OPTIONS} onChange={(value) => actions.setUiScale(Number(value) as typeof launcher.uiScale)} /></label>,
        },
        {
          id: "minimize-to-tray",
          searchText: "Minimize launcher to tray notification area close behavior",
          content: <label class="settings-check"><input type="checkbox" checked={launcher.minimizeToTray} disabled={busy} onChange={(event) => actions.setMinimizeToTray(event.currentTarget.checked)} /><span>Minimize launcher to tray</span></label>,
        },
      ],
    },
    {
      id: "network",
      label: "Network",
      description: "Npcap capture configuration.",
      items: [
        {
          id: "npcap-status",
          searchText: "Npcap status availability version capture driver",
          content: <><div class="settings-row"><span>Status</span><strong>{launcher.npcapAvailability}</strong></div><p class="settings-hint">{launcher.npcapVersion ? `${launcher.npcapDetail} · ${launcher.npcapVersion}` : launcher.npcapDetail}</p></>,
        },
        {
          id: "network-adapter",
          searchText: "Network adapter automatic default route saved capture device",
          content: <label class="settings-field"><span>Network adapter</span><CustomSelect ariaLabel="Network adapter" disabled={busy || launcher.npcapAvailability !== "ready"} value={launcher.selectedAdapter} options={adapterOptions} onChange={actions.setCaptureAdapter} /></label>,
        },
        {
          id: "capture-actions",
          searchText: "Refresh capture devices get download install Npcap",
          content: <div class="settings-actions"><button class="btn" type="button" onClick={actions.refreshCaptureDevices}>Refresh</button>{launcher.npcapAvailability !== "ready" && <button class="btn primary" type="button" onClick={actions.openNpcapDownload}>Get Npcap</button>}</div>,
        },
      ],
    },
    {
      id: "combat",
      label: "Combat",
      description: "Control how combat tracking behaves.",
      items: [
        {
          id: "reset-meter",
          searchText: "Reset meter map channel change new session zone keybind",
          content: <><label class="settings-check"><input type="checkbox" checked={launcher.resetMeterOnMapChange} disabled={busy} onChange={(event) => actions.setResetMeterOnMapChange(event.currentTarget.checked)} /><span>Reset meter on map/channel change</span></label><p class="settings-hint">Starts a new session when you zone or switch channel, exactly as the Reset session keybind does.</p></>,
        },
        {
          id: "reset-gold",
          searchText: "Reset gold map channel change all-time tracker zone",
          content: <><label class="settings-check"><input type="checkbox" checked={launcher.resetGoldOnMapChange} disabled={busy} onChange={(event) => actions.setResetGoldOnMapChange(event.currentTarget.checked)} /><span>Reset gold on map/channel change</span></label><p class="settings-hint">Resets the all-time gold tracker whenever you zone or switch channel.</p></>,
        },
        {
          id: "personal-dps",
          searchText: "Personal DPS display encounter average party meter live recent rate estimate",
          content: <><label class="settings-field"><span>Personal DPS display</span><CustomSelect ariaLabel="Personal DPS display" disabled={busy} value={overlay.personalDpsMode} options={PERSONAL_DPS_MODE_OPTIONS} onChange={(value) => actions.setPersonalDpsMode(value as typeof overlay.personalDpsMode)} /></label><p class="settings-hint">Controls whether your personal DPS tile shows the whole-encounter average (matches the party meter) or a live, recent-rate estimate.</p></>,
        },
      ],
    },
  ];
}
