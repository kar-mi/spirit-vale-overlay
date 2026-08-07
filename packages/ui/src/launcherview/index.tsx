import { signal } from "@preact/signals";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { Electroview } from "electrobun/view";
import { initWindowChrome, type WindowChrome } from "@spiritvale/ui-core/window-chrome";
import { repairRendererPayload } from "@spiritvale/ui-core/renderer-text";
import { formatBytes, formatMeasuredAt } from "@spiritvale/ui-core/format";
import type { LauncherRpc, LauncherState, ToolWindow } from "../launcher-types.ts";

const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 430;
const MINIMUM_WIDTH = 900;
const MINIMUM_HEIGHT = 430;

const TOOLS: Array<{ tool: ToolWindow; title: string; description: string }> = [
  { tool: "combat", title: "Combat", description: "Live DPS and combat replay" },
  { tool: "rewards", title: "Rewards", description: "Mob rewards and catalog" },
  { tool: "character", title: "Character", description: "Your build and calculated stats" },
  { tool: "build-export", title: "Build Export", description: "Open your character in the spiritvalers.com planner" },
];

const state = signal<LauncherState | undefined>(undefined);
const rpc = Electroview.defineRPC<LauncherRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = repairRendererPayload(next); } } },
});
const electroview = new Electroview({ rpc });

void ensureInitialWindowSize();
void electroview.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });

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

function App() {
  const chromeRef = useRef<WindowChrome | undefined>(undefined);
  const titlebarRef = (node: HTMLElement | null): void => {
    if (!node || chromeRef.current) return;
    chromeRef.current = initWindowChrome({
      titlebar: node,
      minWidth: MINIMUM_WIDTH,
      minHeight: MINIMUM_HEIGHT,
      getFrame: async () => (await electroview.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
      setFrame: (frame) => void electroview.rpc?.request.setWindowFrame(frame),
    });
  };

  const next = state.value;
  const unavailable = next?.captureStatus === "unavailable";

  return (
    <main class="app-shell">
      <header ref={titlebarRef} class="titlebar">
        <div class="brand">
          <img class="brand-icon" src="views://assets/app-icon.png" alt="" />
          <span>Spirit Vale</span>
          <span class="brand-version">{next ? `v${next.appVersion}` : ""}</span>
          <span class="brand-tag">Tools</span>
        </div>
        <div class="window-controls">
          <button class="icon-button" type="button" aria-label="Settings" title="Settings" onClick={() => void electroview.rpc?.request.openSettings({})}>⚙</button>
          <button class="icon-button" type="button" aria-label="Minimize" title="Minimize" onClick={() => void electroview.rpc?.request.windowAction({ action: "minimize" })}>−</button>
          <button class="icon-button close-button" type="button" aria-label="Close" title="Close" onClick={() => void electroview.rpc?.request.windowAction({ action: "close" })}>×</button>
        </div>
      </header>

      <section class="launcher-content">
        <div class={unavailable ? "capture-status is-error" : "capture-status"} aria-live="polite">
          <span class={`status-dot ${unavailable ? "is-err" : next?.captureStatus === "capturing" ? "is-ok" : "is-idle"}`} />
          <div><strong>Central capture</strong><p>{next?.statusDetail ?? "Starting centralized capture…"}</p></div>
        </div>

        {next?.storageWarning && <div class="banner is-warn" aria-live="polite">{next.storageWarning}</div>}

        {next?.update && <UpdateNotification version={next.update.version} />}

        <div class="tool-grid" aria-label="Spirit Vale tools">
          {TOOLS.map(({ tool, title, description }) => (
            <button
              key={tool}
              class="tool-button"
              type="button"
              onClick={() => void electroview.rpc?.request.openTool({ tool })}
            >
              <strong>{title}</strong>
              <span>{description}</span>
            </button>
          ))}
        </div>
      </section>

      {next?.logStorage && <LogStorage usage={next.logStorage} />}
    </main>
  );
}

/**
 * Disk used by the log directory. Taken once at launch, so it is stamped with when it was measured
 * rather than presented as a live figure.
 */
function LogStorage({ usage }: { usage: NonNullable<LauncherState["logStorage"]> }) {
  return (
    <footer class="log-storage" title={`${usage.files.toLocaleString()} files in the logs folder`}>
      <span class="log-storage-label">Logs</span>
      <strong>{formatBytes(usage.bytes)}</strong>
      <span class="log-storage-time">{`measured ${formatMeasuredAt(usage.measuredAt)}`}</span>
    </footer>
  );
}

function UpdateNotification({ version }: { version: string }) {
  return (
    <div class="update-notification" aria-live="polite">
      <div><strong>Update available</strong><p>{`Version ${version} is available on GitHub.`}</p></div>
      <div class="update-actions">
        <button class="update-button" type="button" onClick={() => void electroview.rpc?.request.openUpdateRelease({})}>View download</button>
        <button class="update-skip-button" type="button" onClick={() => void electroview.rpc?.request.skipUpdateVersion({})}>Skip version</button>
        <button class="update-dismiss-button" type="button" aria-label="Dismiss update notification" title="Dismiss" onClick={() => void electroview.rpc?.request.dismissUpdateNotification({})}>×</button>
      </div>
    </div>
  );
}

render(<App />, document.getElementById("root")!);
