import { Electroview } from "electrobun/view";
import { initWindowChrome } from "@spiritvale/ui-core/window-chrome";

import type { SessionPickerRpc, SessionPickerState } from "@spiritvale/ui-core/session-picker-types";

let state: SessionPickerState | undefined;
let selectedId: string | undefined;

const rpc = Electroview.defineRPC<SessionPickerRpc>({ handlers: { requests: {}, messages: { stateChanged: render } } });
const electroview = new Electroview({ rpc });
const list = element("session-list");
const status = element("picker-status");
const openButton = button("open-button");
const openLogFolderButton = button("open-log-folder-button");

button("minimize-button").addEventListener("click", () => electroview.rpc?.send.windowAction({ action: "minimize" }));
button("close-button").addEventListener("click", () => electroview.rpc?.send.windowAction({ action: "close" }));
button("refresh-button").addEventListener("click", () => electroview.rpc?.send.refresh({}));
button("choose-file-button").addEventListener("click", () => electroview.rpc?.send.chooseFile({}));
openButton.addEventListener("click", openSelected);
openLogFolderButton.addEventListener("click", () => electroview.rpc?.send.openLogFolder({}));

initWindowChrome({
  titlebar: element("titlebar"), minWidth: 480, minHeight: 400,
  getFrame: async () => (await electroview.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: 640, height: 560 },
  setFrame: (frame) => void electroview.rpc?.request.setWindowFrame(frame),
});

void electroview.rpc?.request.getState({}).then(render);

function render(next: SessionPickerState): void {
  state = next;
  document.title = next.title;
  element("picker-title").textContent = next.title;
  status.textContent = next.statusDetail;
  status.className = `picker-status is-${next.status}`;
  if (!next.sessions.some((session) => session.id === selectedId && !session.disabled)) selectedId = undefined;
  list.replaceChildren();
  if (next.status === "loading") list.append(empty("Loading recent sessions…"));
  else if (next.sessions.length === 0) list.append(empty(next.status === "error" ? "Refresh to try scanning again." : "You can still choose a specific JSON file."));
  else for (const session of next.sessions) list.append(sessionRow(session));
  openButton.disabled = selectedId === undefined;
  openLogFolderButton.hidden = !next.canOpenLogFolder;
}

function sessionRow(session: SessionPickerState["sessions"][number]): HTMLElement {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "session-row";
  row.disabled = session.disabled;
  row.classList.toggle("selected", session.id === selectedId);
  row.setAttribute("aria-pressed", String(session.id === selectedId));
  const heading = document.createElement("span");
  heading.className = "session-heading";
  const timestamp = document.createElement("span");
  timestamp.className = "session-time";
  timestamp.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.createdAt));
  heading.append(timestamp);
  if (session.active) { const badge = document.createElement("span"); badge.className = "pill active-badge"; badge.textContent = "Active"; heading.append(badge); }
  const summary = document.createElement("span");
  summary.className = "session-summary";
  summary.textContent = session.summary;
  row.append(heading, summary);
  row.addEventListener("click", () => {
    selectedId = session.id;
    if (state) render(state);
    openSelected();
  });
  return row;
}

function openSelected(): void {
  if (selectedId) electroview.rpc?.send.openSession({ id: selectedId });
}

function empty(message: string): HTMLElement {
  const node = document.createElement("div"); node.className = "empty-state"; node.textContent = message; return node;
}

function element(id: string): HTMLElement { const value = document.getElementById(id); if (!value) throw new Error(`Missing #${id}`); return value; }
function button(id: string): HTMLButtonElement { return element(id) as HTMLButtonElement; }
