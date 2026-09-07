import type { StartupFailure } from "../shared/protocol.ts";

export const BACKEND_LOST_MESSAGE =
  "Disconnected from Spirit Vale Overlay. Close this window and reopen it from the launcher.";

export interface StartupFailureActions {
  openApplicationFolder(path: string): void;
  quitApplication(): void;
}

export function clearBackendFailureUi(): void {
  document.getElementById("desktop-startup-failure")?.remove();
  setBackendBanner(undefined);
}

// Top-pinned banner for child windows, styled by ui-kit's `.banner`.
export function setBackendBanner(message: string | undefined): void {
  const id = "desktop-backend-banner";
  if (message === undefined) {
    document.getElementById(id)?.remove();
    return;
  }
  let banner = document.getElementById(id);
  if (!banner) {
    banner = document.createElement("div");
    banner.id = id;
    banner.className = "banner is-error";
    banner.setAttribute("role", "status");
    banner.style.cssText = "position:fixed;inset:0 0 auto 0;z-index:2147483000;justify-content:center";
    document.body.prepend(banner);
  }
  banner.textContent = message;
}

export function renderStartupFailure(failure: StartupFailure, actions: StartupFailureActions): void {
  document.getElementById("desktop-startup-failure")?.remove();
  const overlay = document.createElement("section");
  overlay.id = "desktop-startup-failure";
  overlay.setAttribute("role", "alert");
  const heading = "Spirit Vale Overlay could not start";
  const guidance = "The app retried this operation, but the file or folder remained unavailable. Close other programs that may be scanning or synchronizing it and try again. If it keeps failing, make sure the complete extracted folder is writable or move it to a local folder.";
  overlay.innerHTML = `
    <style>
      #desktop-startup-failure{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:28px;background:#0c110e;color:#edf5ee;font:14px/1.45 system-ui,sans-serif}
      #desktop-startup-failure .card{width:min(680px,100%);padding:24px;border:1px solid #b95252;border-radius:14px;background:#171d19;box-shadow:0 18px 50px #0008}
      #desktop-startup-failure h1{margin:0 0 10px;font-size:22px}#desktop-startup-failure p{margin:8px 0;color:#c8d2ca}
      #desktop-startup-failure dl{display:grid;grid-template-columns:max-content 1fr;gap:5px 12px;margin:16px 0;padding:12px;border-radius:8px;background:#0f1511}
      #desktop-startup-failure dt{color:#91a095}#desktop-startup-failure dd{margin:0;overflow-wrap:anywhere}
      #desktop-startup-failure .actions{display:flex;gap:8px;margin-top:18px}#desktop-startup-failure button{padding:9px 13px;border:1px solid #667269;border-radius:7px;background:#252d27;color:#edf5ee;cursor:pointer}
    </style>
    <div class="card">
      <h1>${heading}</h1>
      <p>${escapeHtml(failure.message)}</p>
      <p>${guidance}</p>
      <dl>
        <dt>Phase</dt><dd>${escapeHtml(failure.phase)}</dd>
        ${failure.category ? `<dt>Category</dt><dd>${escapeHtml(failure.category)}</dd>` : ""}
        <dt>Operation</dt><dd>${escapeHtml(failure.operation)}</dd>
        ${failure.code ? `<dt>Error code</dt><dd>${escapeHtml(failure.code)}</dd>` : ""}
        ${failure.path ? `<dt>Path</dt><dd>${escapeHtml(failure.path)}</dd>` : ""}
        ${failure.logPaths?.length ? `<dt>Logs</dt><dd>${failure.logPaths.map(escapeHtml).join("<br>")}</dd>` : ""}
      </dl>
      <div class="actions">${failure.applicationPath ? '<button type="button" data-action="folder">Open application folder</button>' : ""}<button type="button" data-action="exit">Exit</button></div>
    </div>`;
  overlay.querySelector<HTMLButtonElement>('[data-action="folder"]')?.addEventListener("click", () => {
    if (failure.applicationPath) actions.openApplicationFolder(failure.applicationPath);
  });
  overlay.querySelector<HTMLButtonElement>('[data-action="exit"]')?.addEventListener("click", () => actions.quitApplication());
  document.body.append(overlay);
}

export function escapeHtml(value: string): string {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
}
