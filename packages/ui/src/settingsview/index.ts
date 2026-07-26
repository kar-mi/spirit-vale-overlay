import { Electroview } from "electrobun/view";
import { initWindowChrome } from "@spiritvale/ui-core/window-chrome";
import type { LauncherSettingsRpc, LauncherState } from "../launcher-types.ts";

const rpc = Electroview.defineRPC<LauncherSettingsRpc>({ handlers: { requests: {}, messages: { stateChanged: render } } });
const electroview = new Electroview({ rpc });
const adapterSelect = element("adapter-select") as HTMLSelectElement;
const uiScaleSelect = element("ui-scale-select") as HTMLSelectElement;
const minimizeToTrayInput = element("minimize-to-tray-input") as HTMLInputElement;
const npcapStatus = element("npcap-status");
const npcapDetail = element("npcap-detail");
const adapterDetail = element("adapter-detail");
const installNpcapButton = button("install-npcap-button");
const storageWarning = element("storage-warning");
const tabs = [button("general-tab"), button("network-tab")];
const panels = [element("general-panel"), element("network-panel")];

button("minimize-button").addEventListener("click", () => void electroview.rpc?.request.windowAction({ action: "minimize" }));
button("close-button").addEventListener("click", () => void electroview.rpc?.request.windowAction({ action: "close" }));
tabs.forEach((tab, index) => tab.addEventListener("click", () => selectTab(index)));
button("refresh-adapters-button").addEventListener("click", () => void electroview.rpc?.request.refreshCaptureDevices({}).then(render));
installNpcapButton.addEventListener("click", () => void electroview.rpc?.request.openNpcapDownload({}));
adapterSelect.addEventListener("change", () => {
  adapterSelect.disabled = true;
  const deviceName = adapterSelect.value === "auto" ? null : adapterSelect.value;
  void electroview.rpc?.request.setCaptureAdapter({ deviceName }).then(render).catch((error: unknown) => {
    adapterDetail.textContent = error instanceof Error ? error.message : "Could not switch adapters";
  }).finally(() => { adapterSelect.disabled = false; });
});
uiScaleSelect.addEventListener("change", () => {
  uiScaleSelect.disabled = true;
  void electroview.rpc?.request.setUiScale({ uiScale: Number(uiScaleSelect.value) as LauncherState["uiScale"] }).then(render).finally(() => { uiScaleSelect.disabled = false; });
});
minimizeToTrayInput.addEventListener("change", () => {
  minimizeToTrayInput.disabled = true;
  void electroview.rpc?.request.setMinimizeToTray({ minimizeToTray: minimizeToTrayInput.checked }).then(render).finally(() => { minimizeToTrayInput.disabled = false; });
});

initWindowChrome({
  titlebar: element("titlebar"), minWidth: 420, minHeight: 360,
  getFrame: async () => (await electroview.rpc?.request.getWindowFrame({})) ?? { x: 110, y: 110, width: 520, height: 460 },
  setFrame: (frame) => void electroview.rpc?.request.setWindowFrame(frame),
});

void electroview.rpc?.request.getState({}).then(render);

function render(state: LauncherState): void {
  uiScaleSelect.value = String(state.uiScale);
  minimizeToTrayInput.checked = state.minimizeToTray;
  storageWarning.hidden = state.storageWarning === undefined;
  storageWarning.textContent = state.storageWarning ?? "";
  npcapStatus.textContent = availabilityLabel(state.npcapAvailability);
  npcapDetail.textContent = state.npcapVersion ? `${state.npcapDetail} · ${state.npcapVersion}` : state.npcapDetail;
  installNpcapButton.hidden = state.npcapAvailability === "ready" || state.npcapAvailability === "checking";
  const options: HTMLOptionElement[] = [];
  const automatic = document.createElement("option"); automatic.value = "auto"; automatic.textContent = "Automatic (default route)"; options.push(automatic);
  for (const adapter of state.adapters) { const option = document.createElement("option"); option.value = adapter.id; option.textContent = adapter.label; options.push(option); }
  if (state.selectedAdapter !== "auto" && !state.adapters.some((adapter) => adapter.id === state.selectedAdapter)) {
    const unavailable = document.createElement("option"); unavailable.value = state.selectedAdapter; unavailable.textContent = "Saved adapter (currently unavailable)"; options.push(unavailable);
  }
  adapterSelect.replaceChildren(...options); adapterSelect.value = state.selectedAdapter; adapterSelect.disabled = state.npcapAvailability !== "ready";
  const effective = state.adapters.find((adapter) => adapter.id === state.effectiveAdapter)?.label;
  adapterDetail.textContent = state.adapterFallback ? `The saved adapter is unavailable. Currently using ${effective ?? "automatic selection"}.` : effective ? `Currently using ${effective}.` : "Select Automatic to follow the active default route.";
}

function selectTab(index: number): void {
  tabs.forEach((tab, tabIndex) => {
    const selected = tabIndex === index;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
    panels[tabIndex]!.hidden = !selected;
  });
}

function availabilityLabel(value: LauncherState["npcapAvailability"]): string { if (value === "ready") return "Ready"; if (value === "missing") return "Not installed"; if (value === "admin-only") return "Administrator-only installation"; if (value === "error") return "Unavailable"; return "Checking…"; }
function element(id: string): HTMLElement { const value = document.getElementById(id); if (!value) throw new Error(`Missing #${id}`); return value; }
function button(id: string): HTMLButtonElement { return element(id) as HTMLButtonElement; }
