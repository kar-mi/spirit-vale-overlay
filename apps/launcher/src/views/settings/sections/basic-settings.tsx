import { UI_SCALE_VALUES } from "@svoverlay/desktop-platform/ui-scale";
import { CustomSelect } from "@svoverlay/ui-kit/custom-select";
import type { NpcapAvailability } from "../../../launcher/types.ts";
import { useEffect, useState } from "preact/hooks";
import type { SettingsSection, SettingsSectionContext } from "../settings-section.ts";
import type { MessageKey } from "@svoverlay/i18n/messages";

const UI_SCALE_OPTIONS = UI_SCALE_VALUES.map((value) => ({ value: String(value), label: `${Math.round(value * 100)}%` }));

const NPCAP_AVAILABILITY_KEYS: Record<NpcapAvailability, MessageKey> = {
  checking: "npcap.availability.checking",
  ready: "npcap.availability.ready",
  missing: "npcap.availability.missing",
  "admin-only": "npcap.availability.adminOnly",
  error: "npcap.availability.error",
};

function PastLogLimitInput({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (next: number) => void }) {
  const [text, setText] = useState(() => String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  const commit = () => {
    setFocused(false);
    const parsed = Number(text);
    if (Number.isFinite(parsed)) onChange(parsed);
    else setText(String(value));
  };

  return <input
    class="input settings-number"
    type="number"
    min="100"
    max="100000"
    step="1"
    value={text}
    disabled={disabled}
    onFocus={() => setFocused(true)}
    onInput={(event) => setText(event.currentTarget.value)}
    onBlur={commit}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
  />;
}

export function buildBasicSettingsSections({ state, busy, actions, t }: SettingsSectionContext): SettingsSection[] {
  const { launcher, overlay } = state;
  const personalDpsModeOptions = [
    { value: "encounter", label: t("settings.combat.personalDps.encounter") },
    { value: "live", label: t("settings.combat.personalDps.live") },
  ];
  const adapterOptions = [
    { value: "auto", label: t("settings.network.adapter.auto") },
    ...launcher.adapters.map((adapter) => ({ value: adapter.id, label: adapter.label })),
    ...(launcher.selectedAdapter !== "auto" && !launcher.adapters.some((adapter) => adapter.id === launcher.selectedAdapter)
      ? [{ value: launcher.selectedAdapter, label: t("settings.network.adapter.unavailable") }] : []),
  ];
  const npcapDetail = t.text(launcher.npcapDetail);

  return [
    {
      id: "general",
      label: t("settings.general.label"),
      description: t("settings.general.description"),
      items: [
        {
          id: "interface-scale",
          searchText: t("settings.general.interfaceScale.search"),
          content: <label class="settings-field"><span>{t("settings.general.interfaceScale.label")}</span><CustomSelect ariaLabel={t("settings.general.interfaceScale.label")} disabled={busy} value={String(launcher.uiScale)} options={UI_SCALE_OPTIONS} onChange={(value) => actions.setUiScale(Number(value) as typeof launcher.uiScale)} /></label>,
        },
        {
          id: "minimize-to-tray",
          searchText: t("settings.general.minimizeToTray.search"),
          content: <label class="settings-check"><input type="checkbox" checked={launcher.minimizeToTray} disabled={busy} onChange={(event) => actions.setMinimizeToTray(event.currentTarget.checked)} /><span>{t("settings.general.minimizeToTray.label")}</span></label>,
        },
      ],
    },
    {
      id: "network",
      label: t("settings.network.label"),
      description: t("settings.network.description"),
      items: [
        {
          id: "npcap-status",
          searchText: t("settings.network.npcapStatus.search"),
          content: <><div class="settings-row"><span>{t("settings.network.npcapStatus.label")}</span><strong>{t(NPCAP_AVAILABILITY_KEYS[launcher.npcapAvailability])}</strong></div><p class="settings-hint">{launcher.npcapVersion ? `${npcapDetail} · ${launcher.npcapVersion}` : npcapDetail}</p></>,
        },
        {
          id: "network-adapter",
          searchText: t("settings.network.adapter.search"),
          content: <label class="settings-field"><span>{t("settings.network.adapter.label")}</span><CustomSelect ariaLabel={t("settings.network.adapter.label")} disabled={busy || launcher.npcapAvailability !== "ready"} value={launcher.selectedAdapter} options={adapterOptions} onChange={actions.setCaptureAdapter} /></label>,
        },
        {
          id: "capture-actions",
          searchText: t("settings.network.actions.search"),
          content: <div class="settings-actions"><button class="btn" type="button" onClick={actions.refreshCaptureDevices}>{t("settings.network.actions.refresh")}</button>{launcher.npcapAvailability !== "ready" && <button class="btn primary" type="button" onClick={actions.openNpcapDownload}>{t("settings.network.actions.getNpcap")}</button>}</div>,
        },
      ],
    },
    {
      id: "combat",
      label: t("settings.combat.label"),
      description: t("settings.combat.description"),
      items: [
        {
          id: "reset-meter",
          searchText: t("settings.combat.resetMeter.search"),
          content: <><label class="settings-check"><input type="checkbox" checked={launcher.resetMeterOnMapChange} disabled={busy} onChange={(event) => actions.setResetMeterOnMapChange(event.currentTarget.checked)} /><span>{t("settings.combat.resetMeter.label")}</span></label><p class="settings-hint">{t("settings.combat.resetMeter.hint")}</p></>,
        },
        {
          id: "reset-gold",
          searchText: t("settings.combat.resetGold.search"),
          content: <><label class="settings-check"><input type="checkbox" checked={launcher.resetGoldOnMapChange} disabled={busy} onChange={(event) => actions.setResetGoldOnMapChange(event.currentTarget.checked)} /><span>{t("settings.combat.resetGold.label")}</span></label><p class="settings-hint">{t("settings.combat.resetGold.hint")}</p></>,
        },
        {
          id: "past-log-limit",
          searchText: t("settings.combat.pastLogLimit.search"),
          content: <><label class="settings-field"><span>{t("settings.combat.pastLogLimit.label")}</span><PastLogLimitInput value={launcher.pastLogLimit} disabled={busy} onChange={actions.setPastLogLimit} /></label><p class="settings-hint">{t("settings.combat.pastLogLimit.hint")}</p></>,
        },
        {
          id: "personal-dps",
          searchText: t("settings.combat.personalDps.search"),
          content: <><label class="settings-field"><span>{t("settings.combat.personalDps.label")}</span><CustomSelect ariaLabel={t("settings.combat.personalDps.label")} disabled={busy} value={overlay.personalDpsMode} options={personalDpsModeOptions} onChange={(value) => actions.setPersonalDpsMode(value as typeof overlay.personalDpsMode)} /></label><p class="settings-hint">{t("settings.combat.personalDps.hint")}</p></>,
        },
      ],
    },
  ];
}
