import { Electroview } from "electrobun/view";
import { initWindowChrome } from "@spiritvale/ui-core/window-chrome";

import type { LauncherRpc, LauncherState, ToolWindow } from "../launcher-types.ts";

const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 430;
const MINIMUM_WIDTH = 900;
const MINIMUM_HEIGHT = 430;

const rpc = Electroview.defineRPC<LauncherRpc>({
  handlers: { requests: {}, messages: { stateChanged: render } },
});
const electroview = new Electroview({ rpc });

const statusPanel = element("capture-status");
const statusDot = element("status-dot");
const statusText = element("status-text");
const storageWarning = element("storage-warning");

for (const candidate of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
  candidate.addEventListener("click", () => {
    const tool = candidate.dataset.tool as ToolWindow;
    void electroview.rpc?.request.openTool({ tool });
  });
}

button("minimize-button").addEventListener("click", () => void electroview.rpc?.request.windowAction({ action: "minimize" }));
button("close-button").addEventListener("click", () => void electroview.rpc?.request.windowAction({ action: "close" }));
button("settings-button").addEventListener("click", () => void electroview.rpc?.request.openSettings({}));

initWindowChrome({
  titlebar: element("titlebar"),
  minWidth: MINIMUM_WIDTH,
  minHeight: MINIMUM_HEIGHT,
  getFrame: async () => (await electroview.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
  setFrame: (frame) => void electroview.rpc?.request.setWindowFrame(frame),
});

void ensureInitialWindowSize();
void electroview.rpc?.request.getState({}).then(render);

async function ensureInitialWindowSize(): Promise<void> {
  const requests = electroview.rpc?.request;
  if (!requests) return;
  const frame = await requests.getWindowFrame({});
  const scale = window.devicePixelRatio || 1;
  const width = Math.max(frame.width, Math.ceil(DEFAULT_WIDTH * scale));
  const height = Math.max(frame.height, Math.ceil(DEFAULT_HEIGHT * scale));
  if (width === frame.width && height === frame.height) return;
  await requests.setWindowFrame({ ...frame, width, height });
}

function render(state: LauncherState): void {
  const unavailable = state.captureStatus === "unavailable";
  statusPanel.classList.toggle("is-error", unavailable);
  statusDot.className = `status-dot ${unavailable ? "is-err" : state.captureStatus === "capturing" ? "is-ok" : "is-idle"}`;
  statusText.textContent = state.statusDetail;
  storageWarning.hidden = state.storageWarning === undefined;
  storageWarning.textContent = state.storageWarning ?? "";
}

function element(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value;
}

function button(id: string): HTMLButtonElement { return element(id) as HTMLButtonElement; }
