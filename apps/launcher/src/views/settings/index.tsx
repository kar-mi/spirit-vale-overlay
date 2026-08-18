import { signal } from "@preact/signals";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Electroview } from "electrobun/view";
import { TitleBar } from "@svoverlay/ui-kit/title-bar";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { CustomSelect } from "@svoverlay/ui-kit/custom-select";
import { CheckboxMultiSelect } from "@svoverlay/ui-kit/checkbox-multi-select";
import { UI_SCALE_VALUES } from "@svoverlay/desktop-platform/ui-scale";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";
import {
  KEYBIND_ACTIONS,
  OVERLAY_ELEMENT_IDS,
  OVERLAY_ELEMENT_LABELS,
  type KeybindAction,
  type RequiredStatusCategory,
} from "@svoverlay/overlay/app-types";
import { REQUIRED_STATUS_CATEGORIES, requiredStatusOptions } from "@svoverlay/overlay/required-statuses";
import type { LauncherSettingsRpc, SharedSettingsState } from "../../launcher/types.ts";
import { filterSettingsSections, normalizeSettingsSearch } from "./settings-search.ts";
import { shortcutFromKeyboardEvent } from "./shortcut-from-keyboard-event.ts";

type SectionId = "general" | "network" | "overlay" | "combat" | "status" | "keybinds";
interface SettingsItem {
  id: string;
  searchText: string;
  content: ComponentChildren;
}
interface SettingsSection {
  id: SectionId;
  label: string;
  description: string;
  items: SettingsItem[];
}
const state = signal<SharedSettingsState | undefined>(undefined);
const recordingAction = signal<KeybindAction | undefined>(undefined);
const rpc = Electroview.defineRPC<LauncherSettingsRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = repairRendererPayload(next); } } },
});
const electroview = new Electroview({ rpc });
void electroview.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });

const SETTINGS_DEFAULT_WIDTH = 798;
const SETTINGS_DEFAULT_HEIGHT = 680;
void ensureInitialWindowSize(electroview.rpc?.request, { width: 560, height: 420 });

const UI_SCALE_OPTIONS = UI_SCALE_VALUES.map((value) => ({ value: String(value), label: `${Math.round(value * 100)}%` }));
const KEYBIND_LABELS: Record<KeybindAction, string> = {
  toggleLock: "Lock/unlock overlay", resetSession: "Reset session",
  openLiveDeathLog: "Open live death log", toggleOverlayVisible: "Show/hide overlay",
  cycleMeterStatType: "Cycle party meter",
  resetXpTracker: "Reset all-time XP", resetGoldTracker: "Reset all-time gold",
};
const REQUIRED_STATUS_LABELS: Record<RequiredStatusCategory, string> = { buffs: "Buffs", toggles: "Toggles" };
const PERSONAL_DPS_MODE_OPTIONS = [
  { value: "encounter", label: "Encounter average" },
  { value: "live", label: "Live (recent rate)" },
];
/** Status sprites are copied into a single shared assets folder for every view. */
const REQUIRED_STATUS_OPTIONS = Object.fromEntries(REQUIRED_STATUS_CATEGORIES.map((category) => [
  category,
  requiredStatusOptions(category).map((option) => ({
    value: option.statusId,
    label: option.displayName,
    iconSrc: `views://assets/status-icons/${option.spriteId}.webp`,
  })),
])) as Record<RequiredStatusCategory, { value: string; label: string; iconSrc: string }[]>;

function App() {
  const [sectionId, setSectionId] = useState<SectionId>("general");
  const [searchQuery, setSearchQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const next = state.value;
  if (!next) return <main class="app-shell" />;
  const { launcher, overlay } = next;
  const displayOptions = overlay.displays.map((display) => ({ value: display.key, label: display.label }));
  const adapterOptions = [
    { value: "auto", label: "Automatic (default route)" },
    ...launcher.adapters.map((adapter) => ({ value: adapter.id, label: adapter.label })),
    ...(launcher.selectedAdapter !== "auto" && !launcher.adapters.some((adapter) => adapter.id === launcher.selectedAdapter)
      ? [{ value: launcher.selectedAdapter, label: "Saved adapter (currently unavailable)" }] : []),
  ];

  const update = (request: Promise<SharedSettingsState> | undefined): void => {
    if (!request) return;
    setBusy(true);
    void request.then((updated) => { state.value = repairRendererPayload(updated); }).finally(() => setBusy(false));
  };

  const sections: SettingsSection[] = [
    {
      id: "general",
      label: "General",
      description: "Configure application behavior and appearance.",
      items: [
        {
          id: "interface-scale",
          searchText: "Interface scale UI appearance zoom percentage",
          content: <label class="settings-field"><span>Interface scale</span><CustomSelect ariaLabel="Interface scale" disabled={busy} value={String(launcher.uiScale)} options={UI_SCALE_OPTIONS} onChange={(value) => update(electroview.rpc?.request.setUiScale({ uiScale: Number(value) as typeof launcher.uiScale }))} /></label>,
        },
        {
          id: "minimize-to-tray",
          searchText: "Minimize launcher to tray notification area close behavior",
          content: <label class="settings-check"><input type="checkbox" checked={launcher.minimizeToTray} disabled={busy} onChange={(event) => update(electroview.rpc?.request.setMinimizeToTray({ minimizeToTray: event.currentTarget.checked }))} /><span>Minimize launcher to tray</span></label>,
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
          content: <label class="settings-field"><span>Network adapter</span><CustomSelect ariaLabel="Network adapter" disabled={busy || launcher.npcapAvailability !== "ready"} value={launcher.selectedAdapter} options={adapterOptions} onChange={(value) => update(electroview.rpc?.request.setCaptureAdapter({ deviceName: value === "auto" ? null : value }))} /></label>,
        },
        {
          id: "capture-actions",
          searchText: "Refresh capture devices get download install Npcap",
          content: <div class="settings-actions"><button class="btn" type="button" onClick={() => update(electroview.rpc?.request.refreshCaptureDevices({}))}>Refresh</button>{launcher.npcapAvailability !== "ready" && <button class="btn primary" type="button" onClick={() => void electroview.rpc?.request.openNpcapDownload({})}>Get Npcap</button>}</div>,
        },
      ],
    },
    {
      id: "overlay",
      label: "Overlay",
      description: "Control overlay visibility and layout.",
      items: [
        {
          id: "overlay-lock",
          searchText: "Overlay locked unlocked edit mode lock unlock move layout tiles",
          content: <div class="settings-card settings-row"><span><strong>{overlay.locked ? "Overlay locked" : "Edit mode"}</strong></span><button class="btn" type="button" onClick={() => update(electroview.rpc?.request.setOverlayLocked({ locked: !overlay.locked }))}>{overlay.locked ? "Unlock overlay" : "Lock overlay"}</button></div>,
        },
        {
          id: "overlay-visibility",
          searchText: "Overlay shown hidden visible visibility show hide",
          content: <div class="settings-card settings-row"><span><strong>{overlay.overlayVisible ? "Overlay shown" : "Overlay hidden"}</strong></span><button class="btn" type="button" onClick={() => update(electroview.rpc?.request.setOverlayVisible({ visible: !overlay.overlayVisible }))}>{overlay.overlayVisible ? "Hide overlay" : "Show overlay"}</button></div>,
        },
        {
          id: "overlay-auto-hide",
          searchText: "Auto-hide overlay game application focus unfocused switching app manual hide",
          content: <><label class="settings-check"><input type="checkbox" checked={overlay.autoHideWhenUnfocused} disabled={busy} onChange={(event) => update(electroview.rpc?.request.setAutoHideWhenUnfocused({ enabled: event.currentTarget.checked }))} /><span>Auto-hide overlay when the game or Spirit Vale Overlay is not focused</span></label><p class="settings-hint">Spirit Vale and this app's own windows keep the overlay visible. Switching to another app hides it; a manual hide remains hidden until you show it again.</p></>,
        },
        ...(overlay.displays.length > 1 ? [{
          id: "home-display",
          searchText: "Home display monitor screen new tiles disconnected fallback",
          content: <><label class="settings-field"><span>Home display</span><CustomSelect ariaLabel="Home display" disabled={busy} value={overlay.homeDisplay} options={displayOptions} onChange={(value) => update(electroview.rpc?.request.setOverlayHomeDisplay({ display: value }))} /></label><p class="settings-hint">Where new tiles land, and where a tile falls back to if its monitor is disconnected.</p></>,
        }] : []),
        {
          id: "visible-elements",
          searchText: `Visible elements tiles display monitor enable disable ${OVERLAY_ELEMENT_IDS.map((id) => OVERLAY_ELEMENT_LABELS[id]).join(" ")}`,
          content: <><div class="settings-card"><h2>Visible elements</h2>{OVERLAY_ELEMENT_IDS.map((id) => <div class="settings-element-row" key={id}>
            <label class="settings-check settings-element"><input type="checkbox" checked={overlay.elements[id].enabled} onChange={(event) => update(electroview.rpc?.request.setOverlayElementEnabled({ id, enabled: event.currentTarget.checked }))} /><span>{OVERLAY_ELEMENT_LABELS[id]}</span></label>
            {/* Tiles cannot be dragged between monitors — separate documents — so the move happens here. */}
            {overlay.displays.length > 1 && <CustomSelect ariaLabel={`Display for ${OVERLAY_ELEMENT_LABELS[id]}`} disabled={busy} value={overlay.elements[id].display} options={displayOptions} onChange={(value) => update(electroview.rpc?.request.setOverlayElementDisplay({ id, display: value }))} />}
          </div>)}</div><p class="settings-hint">{overlay.personalName ? `Detected character: ${overlay.personalName}` : "Waiting to detect your active character."}</p></>,
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
          content: <><label class="settings-check"><input type="checkbox" checked={launcher.resetMeterOnMapChange} disabled={busy} onChange={(event) => update(electroview.rpc?.request.setResetMeterOnMapChange({ resetMeterOnMapChange: event.currentTarget.checked }))} /><span>Reset meter on map/channel change</span></label><p class="settings-hint">Starts a new session when you zone or switch channel, exactly as the Reset session keybind does.</p></>,
        },
        {
          id: "reset-gold",
          searchText: "Reset gold map channel change all-time tracker zone",
          content: <><label class="settings-check"><input type="checkbox" checked={launcher.resetGoldOnMapChange} disabled={busy} onChange={(event) => update(electroview.rpc?.request.setResetGoldOnMapChange({ resetGoldOnMapChange: event.currentTarget.checked }))} /><span>Reset gold on map/channel change</span></label><p class="settings-hint">Resets the all-time gold tracker whenever you zone or switch channel.</p></>,
        },
        {
          id: "personal-dps",
          searchText: "Personal DPS display encounter average party meter live recent rate estimate",
          content: <><label class="settings-field"><span>Personal DPS display</span><CustomSelect ariaLabel="Personal DPS display" disabled={busy} value={overlay.personalDpsMode} options={PERSONAL_DPS_MODE_OPTIONS} onChange={(value) => update(electroview.rpc?.request.setPersonalDpsMode({ mode: value as "live" | "encounter" }))} /></label><p class="settings-hint">Controls whether your personal DPS tile shows the whole-encounter average (matches the party meter) or a live, recent-rate estimate.</p></>,
        },
      ],
    },
    {
      id: "status",
      label: "Status",
      description: "Warn when the buffs you rely on drop off.",
      items: [{
        id: "missing-buff-warning",
        searchText: "Missing buff warning required statuses buffs toggles selection red outline tiles",
        content: <><div class="settings-card"><h2>Missing buff warning</h2>{REQUIRED_STATUS_CATEGORIES.map((category) => {
          const armed = new Set(overlay.requiredStatuses[category]);
          const setArmed = (statusIds: string[]): void => update(electroview.rpc?.request.setOverlayRequiredStatuses({ category, statusIds }));
          return <div class="settings-field" key={category}>
            <span>{REQUIRED_STATUS_LABELS[category]}</span>
            <CheckboxMultiSelect
              options={REQUIRED_STATUS_OPTIONS[category]}
              selected={armed}
              onChange={(selected) => setArmed([...selected])}
              ariaLabel={`Warn when these ${REQUIRED_STATUS_LABELS[category].toLowerCase()} are missing`}
              searchPlaceholder="Search buffs"
              clearLabel="Clear selection"
              noMatchLabel={(query) => `No buffs match "${query}".`}
              summarize={(chosen) => chosen.size === 0 ? "Select buffs…" : `${chosen.size} selected`}
            />
            {armed.size > 0 && <ul class="status-chips">{REQUIRED_STATUS_OPTIONS[category].filter((option) => armed.has(option.value)).map((option) =>
              <li class="status-chip" key={option.value}>
                <img src={option.iconSrc} alt="" aria-hidden="true" />
                <span>{option.label}</span>
                <button type="button" class="status-chip-remove" aria-label={`Stop warning when ${option.label} is missing`} onClick={() => setArmed([...armed].filter((statusId) => statusId !== option.value))}>×</button>
              </li>)}</ul>}
          </div>;
        })}<p class="settings-hint">Selected buffs that aren't active outline the matching overlay tile in red.</p></div><p class="settings-hint">The Buffs and Toggles tiles must be enabled under Overlay for the warning to be visible.</p></>,
      }],
    },
    {
      id: "keybinds",
      label: "Keybinds",
      description: "Global pass-through shortcuts remain active while Spirit Vale Overlay is running; the foreground app receives the same key press.",
      items: [
        {
          id: "keybind-focus",
          searchText: "Only enable keybinds while Spirit Vale game focused Escape edit mode recovery",
          content: <><label class="settings-check"><input type="checkbox" checked={overlay.keybindsRequireGameFocus} disabled={busy} onChange={(event) => update(electroview.rpc?.request.setKeybindsRequireGameFocus({ enabled: event.currentTarget.checked }))} /><span>Only enable keybinds while Spirit Vale is focused</span></label><p class="settings-hint">The fixed Escape shortcut for leaving overlay edit mode remains available as a recovery action.</p></>,
        },
        {
          id: "keybind-assignments",
          searchText: `Shortcut assignments reset defaults click select record key combination pass through ${Object.values(KEYBIND_LABELS).join(" ")}`,
          content: <><div class="settings-actions"><button class="btn" type="button" disabled={busy} onClick={() => { recordingAction.value = undefined; update(electroview.rpc?.request.resetShortcutsToDefaults({})); }}>Reset to defaults</button></div><section class="keybind-list" aria-label="Keybind assignments"><h2>Click to select</h2>{KEYBIND_ACTIONS.map((action) => <div class="keybind-row" key={action}>
            <span>{KEYBIND_LABELS[action]}</span>
            <button class="btn" type="button" onClick={() => void beginShortcutCapture(action)} onKeyDown={(event) => void captureShortcut(action, event)}>{recordingAction.value === action ? "Press a shortcut…" : overlay.shortcuts[action]}</button>
            {(overlay.shortcutErrors[action] || recordingAction.value === action) && <p class="keybind-message" aria-live="polite">{overlay.shortcutErrors[action] ?? "Press a key or Escape to cancel."}</p>}
          </div>)}</section><p class="settings-hint">Shortcuts pass through to the foreground app. Windows or another app may also use the same combination; Ctrl+Shift can switch input languages when configured that way in Windows.</p></>,
        },
      ],
    },
  ];

  const searching = normalizeSettingsSearch(searchQuery).length > 0;
  const searchResults = filterSettingsSections(searchQuery, sections);
  const matchedItemCount = searchResults.reduce((total, result) => total + result.itemIds.length, 0);
  const selectedSection = sections.find((section) => section.id === sectionId)!;

  const openSection = (id: SectionId): void => {
    setSectionId(id);
    setSearchQuery("");
  };

  const renderItems = (section: SettingsSection, itemIds?: readonly string[]): ComponentChildren => {
    const visibleIds = itemIds ? new Set(itemIds) : undefined;
    return section.items
      .filter((item) => !visibleIds || visibleIds.has(item.id))
      .map((item) => <div class="settings-item" key={item.id}>{item.content}</div>);
  };

  return <main class="app-shell">
    <TitleBar
      appTag="Settings"
      minWidth={560}
      minHeight={420}
      getFrame={async () => (await electroview.rpc?.request.getWindowFrame({})) ?? { x: 110, y: 110, width: SETTINGS_DEFAULT_WIDTH, height: SETTINGS_DEFAULT_HEIGHT }}
      setFrame={(frame) => void electroview.rpc?.request.setWindowFrame(frame)}
      onMinimize={() => void electroview.rpc?.request.windowAction({ action: "minimize" })}
      onClose={() => void electroview.rpc?.request.windowAction({ action: "close" })}
    />
    <section class="settings-content">
      {(launcher.storageWarning || overlay.shortcutErrors.openLiveDeathLog) && <div class="banner is-warn" aria-live="polite">{launcher.storageWarning ?? overlay.shortcutErrors.openLiveDeathLog}</div>}
      <div class="settings-layout">
        <nav class="settings-sidebar" aria-label="Settings sections">
          {sections.map((section) => <button
            class={!searching && section.id === sectionId ? "settings-nav-item is-active" : "settings-nav-item"}
            type="button"
            aria-current={!searching && section.id === sectionId ? "page" : undefined}
            onClick={() => openSection(section.id)}
            key={section.id}
          >{section.label}</button>)}
        </nav>
        <div class="settings-main">
          <div class="settings-toolbar">
            <label class="settings-search">
              <span aria-hidden="true">⌕</span>
              <input class="input" type="search" value={searchQuery} onInput={(event) => setSearchQuery(event.currentTarget.value)} placeholder="Search settings" aria-label="Search all settings" />
            </label>
          </div>
          {searching ? <section class="settings-results" aria-label="Settings search results">
            <header class="settings-heading search-heading">
              <h1>Search results</h1>
              <p class="search-summary" aria-live="polite">{matchedItemCount === 0 ? `No settings match “${searchQuery.trim()}”.` : `${matchedItemCount} ${matchedItemCount === 1 ? "setting" : "settings"} found.`}</p>
            </header>
            {searchResults.map((result) => {
              const section = sections.find((candidate) => candidate.id === result.sectionId)!;
              return <section class="settings-result-group" aria-labelledby={`search-section-${section.id}`} key={section.id}>
                <header class="settings-result-heading"><h2 id={`search-section-${section.id}`}>{section.label}</h2><p>{section.description}</p></header>
                <div class="settings-panel">{renderItems(section, result.itemIds)}</div>
              </section>;
            })}
          </section> : <section class="settings-panel" aria-labelledby={`settings-section-${selectedSection.id}`}>
            <header class="settings-heading"><h1 id={`settings-section-${selectedSection.id}`}>{selectedSection.label}</h1><p>{selectedSection.description}</p></header>
            {renderItems(selectedSection)}
          </section>}
        </div>
      </div>
    </section>
  </main>;
}

function beginShortcutCapture(action: KeybindAction): Promise<void> {
  return electroview.rpc?.request.setShortcutCapture({ active: true }).then((next) => {
    state.value = repairRendererPayload(next);
    recordingAction.value = action;
  }) ?? Promise.resolve();
}

function captureShortcut(action: KeybindAction, event: KeyboardEvent): Promise<void> {
  if (recordingAction.value !== action) return Promise.resolve();
  event.preventDefault();
  if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
    recordingAction.value = undefined;
    return electroview.rpc?.request.setShortcutCapture({ active: false }).then((next) => { state.value = repairRendererPayload(next); }) ?? Promise.resolve();
  }
  const shortcut = shortcutFromKeyboardEvent(event);
  if (!shortcut) return Promise.resolve();
  recordingAction.value = undefined;
  return electroview.rpc?.request.setShortcut({ action, shortcut }).then((next) => { state.value = repairRendererPayload(next); }) ?? Promise.resolve();
}

render(<App />, document.getElementById("root")!);
