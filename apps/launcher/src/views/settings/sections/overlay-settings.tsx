import { CustomSelect } from "@svoverlay/ui-kit/custom-select";
import { OVERLAY_ELEMENT_IDS, OVERLAY_ELEMENT_LABELS } from "@svoverlay/overlay/app-types";
import type { SettingsSection, SettingsSectionContext } from "../settings-section.ts";

export function buildOverlaySettingsSection({ state, busy, actions }: SettingsSectionContext): SettingsSection {
  const { overlay } = state;
  const displayOptions = overlay.displays.map((display) => ({ value: display.key, label: display.label }));

  return {
    id: "overlay",
    label: "Overlay",
    description: "Control overlay visibility and layout.",
    items: [
      {
        id: "overlay-lock",
        searchText: "Overlay locked unlocked edit mode lock unlock move layout tiles",
        content: <div class="settings-card settings-row"><span><strong>{overlay.locked ? "Overlay locked" : "Edit mode"}</strong></span><button class="btn" type="button" onClick={() => actions.setOverlayLocked(!overlay.locked)}>{overlay.locked ? "Unlock overlay" : "Lock overlay"}</button></div>,
      },
      {
        id: "overlay-visibility",
        searchText: "Overlay shown hidden visible visibility show hide",
        content: <div class="settings-card settings-row"><span><strong>{overlay.overlayVisible ? "Overlay shown" : "Overlay hidden"}</strong></span><button class="btn" type="button" onClick={() => actions.setOverlayVisible(!overlay.overlayVisible)}>{overlay.overlayVisible ? "Hide overlay" : "Show overlay"}</button></div>,
      },
      {
        id: "overlay-auto-hide",
        searchText: "Auto-hide overlay game application focus unfocused switching app manual hide",
        content: <><label class="settings-check"><input type="checkbox" checked={overlay.autoHideWhenUnfocused} disabled={busy} onChange={(event) => actions.setAutoHideWhenUnfocused(event.currentTarget.checked)} /><span>Auto-hide overlay when the game or Spirit Vale Overlay is not focused</span></label><p class="settings-hint">Spirit Vale and this app's own windows keep the overlay visible. Switching to another app hides it; a manual hide remains hidden until you show it again.</p></>,
      },
      ...(overlay.displays.length > 1 ? [{
        id: "home-display",
        searchText: "Home display monitor screen new tiles disconnected fallback",
        content: <><label class="settings-field"><span>Home display</span><CustomSelect ariaLabel="Home display" disabled={busy} value={overlay.homeDisplay} options={displayOptions} onChange={actions.setOverlayHomeDisplay} /></label><p class="settings-hint">Where new tiles land, and where a tile falls back to if its monitor is disconnected.</p></>,
      }] : []),
      {
        id: "visible-elements",
        searchText: `Visible elements tiles display monitor enable disable ${OVERLAY_ELEMENT_IDS.map((id) => OVERLAY_ELEMENT_LABELS[id]).join(" ")}`,
        content: <><div class="settings-card"><h2>Visible elements</h2>{OVERLAY_ELEMENT_IDS.map((id) => {
          // The minimap has its own master switch in the Minimap section.
          const rowDisabled = id === "minimap" && !overlay.minimapEnabled;
          return <div class="settings-element-row" key={id}>
            <label class="settings-check settings-element"><input type="checkbox" checked={overlay.elements[id].enabled} disabled={busy || rowDisabled} onChange={(event) => actions.setOverlayElementEnabled(id, event.currentTarget.checked)} /><span>{OVERLAY_ELEMENT_LABELS[id]}</span></label>
            {/* Tiles cannot be dragged between monitors — separate documents — so the move happens here. */}
            {overlay.displays.length > 1 && <CustomSelect ariaLabel={`Display for ${OVERLAY_ELEMENT_LABELS[id]}`} disabled={busy || rowDisabled} value={overlay.elements[id].display} options={displayOptions} onChange={(value) => actions.setOverlayElementDisplay(id, value)} />}
          </div>;
        })}</div>{!overlay.minimapEnabled && <p class="settings-hint">Enable the minimap in the Minimap section to use its row.</p>}<p class="settings-hint">{overlay.personalName ? `Detected character: ${overlay.personalName}` : "Waiting to detect your active character."}</p></>,
      },
    ],
  };
}
