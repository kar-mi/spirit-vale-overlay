import { CustomSelect } from "@svoverlay/ui-kit/custom-select";
import { OVERLAY_ELEMENT_IDS, type OverlayElementId } from "@svoverlay/overlay/app-types";
import type { Translator } from "@svoverlay/i18n/translate";
import type { SettingsSection, SettingsSectionContext } from "../settings-section.ts";

const elementLabel = (t: Translator, id: OverlayElementId): string => t(`overlay.element.${id}`);

export function buildOverlaySettingsSection({ state, busy, actions, t }: SettingsSectionContext): SettingsSection {
  const { overlay } = state;
  const displayOptions = overlay.displays.map((display) => ({ value: display.key, label: display.label }));

  return {
    id: "overlay",
    label: t("settings.overlay.label"),
    description: t("settings.overlay.description"),
    items: [
      {
        id: "overlay-lock",
        searchText: t("settings.overlay.lock.search"),
        content: <div class="settings-card settings-row"><span><strong>{overlay.locked ? t("settings.overlay.lock.locked") : t("settings.overlay.lock.editMode")}</strong></span><button class="btn" type="button" onClick={() => actions.setOverlayLocked(!overlay.locked)}>{overlay.locked ? t("settings.overlay.lock.unlock") : t("settings.overlay.lock.lock")}</button></div>,
      },
      {
        id: "overlay-visibility",
        searchText: t("settings.overlay.visibility.search"),
        content: <div class="settings-card settings-row"><span><strong>{overlay.overlayVisible ? t("settings.overlay.visibility.shown") : t("settings.overlay.visibility.hidden")}</strong></span><button class="btn" type="button" onClick={() => actions.setOverlayVisible(!overlay.overlayVisible)}>{overlay.overlayVisible ? t("settings.overlay.visibility.hide") : t("settings.overlay.visibility.show")}</button></div>,
      },
      {
        id: "overlay-auto-hide",
        searchText: t("settings.overlay.autoHide.search"),
        content: <><label class="settings-check"><input type="checkbox" checked={overlay.autoHideWhenUnfocused} disabled={busy} onChange={(event) => actions.setAutoHideWhenUnfocused(event.currentTarget.checked)} /><span>{t("settings.overlay.autoHide.label")}</span></label><p class="settings-hint">{t("settings.overlay.autoHide.hint")}</p></>,
      },
      ...(overlay.displays.length > 1 ? [{
        id: "home-display",
        searchText: t("settings.overlay.homeDisplay.search"),
        content: <><label class="settings-field"><span>{t("settings.overlay.homeDisplay.label")}</span><CustomSelect ariaLabel={t("settings.overlay.homeDisplay.label")} disabled={busy} value={overlay.homeDisplay} options={displayOptions} onChange={actions.setOverlayHomeDisplay} /></label><p class="settings-hint">{t("settings.overlay.homeDisplay.hint")}</p></>,
      }] : []),
      {
        id: "visible-elements",
        searchText: `${t("settings.overlay.elements.search")} ${OVERLAY_ELEMENT_IDS.map((id) => elementLabel(t, id)).join(" ")}`,
        content: <><div class="settings-card"><h2>{t("settings.overlay.elements.label")}</h2>{OVERLAY_ELEMENT_IDS.map((id) => {
          // The minimap has its own master switch in the Minimap / Loot section.
          const rowDisabled = id === "minimap" && !overlay.minimapEnabled;
          const label = elementLabel(t, id);
          return <div class="settings-element-row" key={id}>
            <label class="settings-check settings-element"><input type="checkbox" checked={overlay.elements[id].enabled} disabled={busy || rowDisabled} onChange={(event) => actions.setOverlayElementEnabled(id, event.currentTarget.checked)} /><span>{label}</span></label>
            {/* Tiles cannot be dragged between monitors — separate documents — so the move happens here. */}
            {overlay.displays.length > 1 && <CustomSelect ariaLabel={t("settings.overlay.elements.displayFor", { element: label })} disabled={busy || rowDisabled} value={overlay.elements[id].display} options={displayOptions} onChange={(value) => actions.setOverlayElementDisplay(id, value)} />}
          </div>;
        })}</div>{!overlay.minimapEnabled && <p class="settings-hint">{t("settings.overlay.elements.minimapOff")}</p>}<p class="settings-hint">{overlay.personalName ? t("settings.overlay.elements.characterDetected", { name: overlay.personalName }) : t("settings.overlay.elements.characterWaiting")}</p></>,
      },
    ],
  };
}
