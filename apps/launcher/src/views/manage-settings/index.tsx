import { signal } from "@preact/signals";
import { render } from "preact";
import { Electroview } from "electrobun/view";
import { DesktopTitleBar } from "@svoverlay/ui-kit/desktop-title-bar";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";
import type { ManageSettingsRpc, ManageSettingsState } from "../../launcher/types.ts";

const DEFAULT_WIDTH = 480;
const DEFAULT_HEIGHT = 380;
const MINIMUM_WIDTH = 420;
const MINIMUM_HEIGHT = 340;

const state = signal<ManageSettingsState | undefined>(undefined);
const rpc = Electroview.defineRPC<ManageSettingsRpc>({
  handlers: { requests: {}, messages: {} },
});
const electroview = new Electroview({ rpc });
void electroview.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });
void ensureInitialWindowSize(electroview.rpc?.request, { width: MINIMUM_WIDTH, height: MINIMUM_HEIGHT });

function App() {
  const next = state.value;

  return (
    <div class="manage-settings-shell">
      <DesktopTitleBar
        appTag="Manage Settings"
        minWidth={MINIMUM_WIDTH}
        minHeight={MINIMUM_HEIGHT}
        defaultWidth={DEFAULT_WIDTH}
        defaultHeight={DEFAULT_HEIGHT}
        requests={electroview.rpc?.request}
      />
      <main>
        <div class="manage-settings-intro">
          <h1>Manage your settings</h1>
          <p class="data-folder-path" title={next?.dataFolder}>{next ? `Settings folder: ${next.dataFolder}` : "Loading…"}</p>
        </div>
        <div class="manage-settings-actions">
          <button class="btn" type="button" onClick={() => void electroview.rpc?.request.importSettings({})}>
            Import Settings…
          </button>
          <button class="btn" type="button" onClick={() => void electroview.rpc?.request.openDataFolder({})}>
            Open Settings Folder
          </button>
          <button class="btn" type="button" onClick={() => void electroview.rpc?.request.resetSettings({})}>
            Reset All Settings…
          </button>
        </div>
      </main>
    </div>
  );
}

render(<App />, document.getElementById("root")!);
