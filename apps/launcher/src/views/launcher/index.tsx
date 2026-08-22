import { signal } from "@preact/signals";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { DesktopView } from "@svoverlay/desktop-runtime/view";
import { initWindowChrome, type WindowChrome } from "@svoverlay/ui-kit/window-chrome";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";
import { formatBytes, formatMeasuredAt } from "@svoverlay/ui-kit/format";
import type { LauncherRpc, LauncherState, ToolWindow } from "../../launcher/types.ts";

const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 430;
const MINIMUM_WIDTH = 900;
const MINIMUM_HEIGHT = 430;

const TOOLS: Array<{ tool: ToolWindow; title: string; description: string }> = [
  { tool: "combat", title: "Combat", description: "Live DPS and combat replay" },
  { tool: "rewards", title: "Rewards", description: "Mob rewards and catalog" },
  { tool: "character", title: "Character", description: "Your build and calculated stats" },
  { tool: "boss-timers", title: "Boss Timers", description: "World boss respawns by region and channel" },
  { tool: "build-export", title: "Build Export", description: "Open your character in the spiritvalers.com planner" },
];

const state = signal<LauncherState | undefined>(undefined);
const rpc = DesktopView.defineRPC<LauncherRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = repairRendererPayload(next); } } },
});
const electroview = new DesktopView({ rpc });

void ensureInitialWindowSize(electroview.rpc?.request, { width: MINIMUM_WIDTH, height: MINIMUM_HEIGHT });
void electroview.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });

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
          <span>Spirit Vale Overlay</span>
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
          {next?.appVersion.includes("neutralino-poc") && (
            <button
              class="tool-button"
              type="button"
              onClick={() => void electroview.rpc?.request.openTool({ tool: "overlay" })}
            >
              <strong>Enable Overlay POC</strong>
              <span>Start the transparent Neutralino overlay windows</span>
            </button>
          )}
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
          <button
            class="tool-button"
            type="button"
            onClick={() => void electroview.rpc?.request.manageSettings({})}
          >
            <strong>Manage Settings</strong>
            <span>Import, locate, or reset your settings</span>
          </button>
        </div>
      </section>

      {next?.overlayShortcuts && <OverlayHints shortcuts={next.overlayShortcuts} />}
      {next?.logStorage && <LogStorage usage={next.logStorage} />}
    </main>
  );
}

function OverlayHints({ shortcuts }: { shortcuts: NonNullable<LauncherState["overlayShortcuts"]> }) {
  return (
    <footer class="overlay-hints">
      <span><kbd>{shortcuts.toggleLock}</kbd> — Edit overlay</span>
      <span><kbd>{shortcuts.toggleOverlayVisible}</kbd> — Toggle overlay</span>
    </footer>
  );
}

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
