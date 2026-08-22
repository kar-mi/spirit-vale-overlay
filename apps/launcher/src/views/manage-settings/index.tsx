import { signal } from "@preact/signals";
import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { DesktopView } from "@svoverlay/desktop-runtime/view";
import { TitleBar } from "@svoverlay/ui-kit/title-bar";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";
import type { ManageSettingsRpc, ManageSettingsState } from "../../launcher/types.ts";

const DEFAULT_WIDTH = 480;
const DEFAULT_HEIGHT = 380;
const MINIMUM_WIDTH = 420;
const MINIMUM_HEIGHT = 340;

const state = signal<ManageSettingsState | undefined>(undefined);
const resetPromptOpen = signal(false);
const rpc = DesktopView.defineRPC<ManageSettingsRpc>({
  handlers: { requests: {}, messages: {} },
});
const desktopView = new DesktopView({ rpc });
void desktopView.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });
void ensureInitialWindowSize(desktopView.rpc?.request, { width: MINIMUM_WIDTH, height: MINIMUM_HEIGHT });

function App() {
  const next = state.value;

  return (
    <div class="manage-settings-shell">
      <TitleBar
        appTag="Manage Settings"
        minWidth={MINIMUM_WIDTH}
        minHeight={MINIMUM_HEIGHT}
        getFrame={async () => (await desktopView.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }}
        setFrame={(frame) => void desktopView.rpc?.request.setWindowFrame(frame)}
        onMinimize={() => void desktopView.rpc?.request.windowAction({ action: "minimize" })}
        onClose={() => void desktopView.rpc?.request.windowAction({ action: "close" })}
      />
      <main>
        <div class="manage-settings-intro">
          <h1>Manage your settings</h1>
          <p class="data-folder-path" title={next?.dataFolder}>{next ? `Settings folder: ${next.dataFolder}` : "Loading…"}</p>
        </div>
        <div class="manage-settings-actions">
          <button class="btn" type="button" onClick={() => void desktopView.rpc?.request.importSettings({})}>
            Import Settings…
          </button>
          <button class="btn" type="button" onClick={() => void desktopView.rpc?.request.openDataFolder({})}>
            Open Settings Folder
          </button>
          <button class="btn" type="button" onClick={() => { resetPromptOpen.value = true; }}>
            Reset All Settings…
          </button>
        </div>
      </main>
      {resetPromptOpen.value ? <ResetSettingsPrompt /> : null}
    </div>
  );
}

function ResetSettingsPrompt() {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelButtonRef.current?.focus(); }, []);

  const cancel = (): void => { resetPromptOpen.value = false; };
  return <div class="modal-layer" role="presentation">
    <form class="modal-card reset-modal" role="dialog" aria-modal="true" aria-labelledby="reset-title" onSubmit={(event) => {
      event.preventDefault();
      resetPromptOpen.value = false;
      void desktopView.rpc?.request.resetSettings({});
    }} onKeyDown={(event) => {
      if (event.key === "Escape") cancel();
    }}>
      <div class="modal-head"><div><h2 id="reset-title">Reset all settings?</h2><p>Reset all settings to their defaults? This cannot be undone.</p></div><button class="modal-close" type="button" aria-label="Cancel" onClick={cancel}>×</button></div>
      <div class="modal-actions"><button ref={cancelButtonRef} class="btn" type="button" onClick={cancel}>Cancel</button><button class="btn reset-button" type="submit">Reset</button></div>
    </form>
  </div>;
}

render(<App />, document.getElementById("root")!);
