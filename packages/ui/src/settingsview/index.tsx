import { signal } from "@preact/signals";
import { render } from "preact";
import { useState } from "preact/hooks";
import { Electroview } from "electrobun/view";
import { TitleBar } from "@spiritvale/ui-core/title-bar";
import { CustomSelect } from "@spiritvale/ui-core/custom-select";
import { UI_SCALE_VALUES } from "@spiritvale/ui-core/ui-scale";
import { repairRendererPayload } from "@spiritvale/ui-core/renderer-text";
import type { LauncherSettingsRpc, LauncherState } from "../launcher-types.ts";

const UI_SCALE_OPTIONS = UI_SCALE_VALUES.map((value) => ({ value: String(value), label: `${Math.round(value * 100)}%` }));

const state = signal<LauncherState | undefined>(undefined);
const rpc = Electroview.defineRPC<LauncherSettingsRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = repairRendererPayload(next); } } },
});
const electroview = new Electroview({ rpc });
void electroview.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });

function App() {
  const [tab, setTab] = useState<"general" | "network">("general");
  const [adapterBusy, setAdapterBusy] = useState(false);
  const [adapterError, setAdapterError] = useState<string | undefined>(undefined);
  const [uiScaleBusy, setUiScaleBusy] = useState(false);
  const [minimizeToTrayBusy, setMinimizeToTrayBusy] = useState(false);

  const next = state.value;
  if (!next) return <main class="app-shell" />;

  const adapterOptions = [
    { value: "auto", label: "Automatic (default route)" },
    ...next.adapters.map((adapter) => ({ value: adapter.id, label: adapter.label })),
    ...(next.selectedAdapter !== "auto" && !next.adapters.some((adapter) => adapter.id === next.selectedAdapter)
      ? [{ value: next.selectedAdapter, label: "Saved adapter (currently unavailable)" }]
      : []),
  ];
  const effective = next.adapters.find((adapter) => adapter.id === next.effectiveAdapter)?.label;

  return (
    <main class="app-shell">
      <TitleBar
        appTag="Settings"
        minWidth={420}
        minHeight={360}
        getFrame={async () => (await electroview.rpc?.request.getWindowFrame({})) ?? { x: 110, y: 110, width: 520, height: 460 }}
        setFrame={(frame) => void electroview.rpc?.request.setWindowFrame(frame)}
        onMinimize={() => void electroview.rpc?.request.windowAction({ action: "minimize" })}
        onClose={() => void electroview.rpc?.request.windowAction({ action: "close" })}
      />
      <section class="settings-content" aria-label="Packet capture settings">
        {next.storageWarning && <div class="banner is-warn" aria-live="polite">{next.storageWarning}</div>}
        <div class="settings-tabs" role="tablist" aria-label="Settings sections">
          <button
            id="general-tab"
            class={tab === "general" ? "settings-tab is-active" : "settings-tab"}
            type="button"
            role="tab"
            aria-selected={tab === "general"}
            aria-controls="general-panel"
            onClick={() => setTab("general")}
          >
            General
          </button>
          <button
            id="network-tab"
            class={tab === "network" ? "settings-tab is-active" : "settings-tab"}
            type="button"
            role="tab"
            aria-selected={tab === "network"}
            aria-controls="network-panel"
            onClick={() => setTab("network")}
          >
            Network
          </button>
        </div>
        <section id="general-panel" class="settings-panel" role="tabpanel" aria-labelledby="general-tab" hidden={tab !== "general"}>
          <header class="settings-heading"><div><h1>General</h1><p>Configure launcher behavior and appearance.</p></div></header>
          <label class="settings-field" for="ui-scale-select">
            <span>Interface scale</span>
            <CustomSelect
              id="ui-scale-select"
              ariaLabel="Interface scale"
              disabled={uiScaleBusy}
              value={String(next.uiScale)}
              options={UI_SCALE_OPTIONS}
              onChange={(value) => {
                setUiScaleBusy(true);
                void electroview.rpc?.request.setUiScale({ uiScale: Number(value) as LauncherState["uiScale"] })
                  .then((updated) => { state.value = updated; })
                  .finally(() => setUiScaleBusy(false));
              }}
            />
          </label>
          <label class="settings-check" for="minimize-to-tray-input">
            <input
              id="minimize-to-tray-input"
              type="checkbox"
              checked={next.minimizeToTray}
              disabled={minimizeToTrayBusy}
              onChange={(event) => {
                setMinimizeToTrayBusy(true);
                void electroview.rpc?.request.setMinimizeToTray({ minimizeToTray: event.currentTarget.checked })
                  .then((updated) => { state.value = updated; })
                  .finally(() => setMinimizeToTrayBusy(false));
              }}
            />
            <span>Minimize to tray</span>
          </label>
        </section>
        <section id="network-panel" class="settings-panel" role="tabpanel" aria-labelledby="network-tab" hidden={tab !== "network"}>
          <header class="settings-heading"><div><h1>Network</h1><p>Npcap is provided by your system.</p></div></header>
          <div class="settings-row"><span>Backend</span><strong>Npcap</strong></div>
          <div class="settings-row settings-status">
            <span>Status</span>
            <div>
              <strong>{availabilityLabel(next.npcapAvailability)}</strong>
              <p>{next.npcapVersion ? `${next.npcapDetail} · ${next.npcapVersion}` : next.npcapDetail}</p>
            </div>
          </div>
          <label class="settings-field" for="adapter-select">
            <span>Network adapter</span>
            <CustomSelect
              id="adapter-select"
              ariaLabel="Network adapter"
              disabled={adapterBusy || next.npcapAvailability !== "ready"}
              value={next.selectedAdapter}
              options={adapterOptions}
              onChange={(value) => {
                setAdapterBusy(true);
                setAdapterError(undefined);
                const deviceName = value === "auto" ? null : value;
                void electroview.rpc?.request.setCaptureAdapter({ deviceName })
                  .then((updated) => { state.value = updated; })
                  .catch((error: unknown) => { setAdapterError(error instanceof Error ? error.message : "Could not switch adapters"); })
                  .finally(() => setAdapterBusy(false));
              }}
            />
          </label>
          <p class="settings-hint">
            {adapterError ?? (next.adapterFallback
              ? `The saved adapter is unavailable. Currently using ${effective ?? "automatic selection"}.`
              : effective
                ? `Currently using ${effective}.`
                : "Select Automatic to follow the active default route.")}
          </p>
          <div class="settings-actions">
            <button
              class="btn"
              type="button"
              onClick={() => void electroview.rpc?.request.refreshCaptureDevices({}).then((updated) => { state.value = updated; })}
            >
              Refresh
            </button>
            {next.npcapAvailability !== "ready" && next.npcapAvailability !== "checking" && (
              <button class="btn primary" type="button" onClick={() => void electroview.rpc?.request.openNpcapDownload({})}>
                Get Npcap
              </button>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function availabilityLabel(value: LauncherState["npcapAvailability"]): string {
  if (value === "ready") return "Ready";
  if (value === "missing") return "Not installed";
  if (value === "admin-only") return "Administrator-only installation";
  if (value === "error") return "Unavailable";
  return "Checking…";
}

render(<App />, document.getElementById("root")!);
