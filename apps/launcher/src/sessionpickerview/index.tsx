import { signal } from "@preact/signals";
import { render } from "preact";
import { useState } from "preact/hooks";
import { Electroview } from "electrobun/view";
import { TitleBar } from "@svoverlay/ui-kit/title-bar";
import { SettingsButton } from "@svoverlay/ui-kit/settings-button";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";
import type { SessionPickerItem, SessionPickerRpc, SessionPickerState } from "@svoverlay/desktop-platform/session-picker-types";

const state = signal<SessionPickerState | undefined>(undefined);
const rpc = Electroview.defineRPC<SessionPickerRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { const repaired = repairRendererPayload(next); state.value = repaired; document.title = repaired.title; } } },
});
const electroview = new Electroview({ rpc });
void electroview.rpc?.request.getState({}).then((next) => { const repaired = repairRendererPayload(next); state.value = repaired; document.title = repaired.title; });

function App() {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const next = state.value;
  if (!next) return <div class="picker-shell" />;

  const validSelectedId = next.sessions.some((session) => session.id === selectedId && !session.disabled) ? selectedId : undefined;

  function openSession(id: string): void {
    if (id) electroview.rpc?.send.openSession({ id });
  }

  function openSelected(): void {
    if (validSelectedId) openSession(validSelectedId);
  }

  return (
    <div class="picker-shell">
      <TitleBar
        appTag={next.title}
        minWidth={480}
        minHeight={400}
        getFrame={async () => (await electroview.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: 640, height: 560 }}
        setFrame={(frame) => void electroview.rpc?.request.setWindowFrame(frame)}
        onMinimize={() => electroview.rpc?.send.windowAction({ action: "minimize" })}
        onClose={() => electroview.rpc?.send.windowAction({ action: "close" })}
        extraControls={<SettingsButton onClick={() => electroview.rpc?.send.openSettings({})} />}
      />
      <main>
        <div class="picker-intro">
          <div>
            <h1>Recent sessions</h1>
            <p class={`picker-status is-${next.status}`} aria-live="polite">{next.statusDetail}</p>
          </div>
          <button class="btn" type="button" onClick={() => electroview.rpc?.send.refresh({})}>Refresh</button>
        </div>
        <div class="session-list" role="listbox" aria-label="Recent sessions">
          {next.sessions.length > 0
            ? next.sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                selected={session.id === validSelectedId}
                onSelect={() => { setSelectedId(session.id); openSession(session.id); }}
              />
            ))
            : next.status === "loading"
              ? <div class="empty-state">Loading recent sessions…</div>
              : <div class="empty-state">{next.status === "error" ? "Refresh to try scanning again." : "You can still choose a specific JSON file."}</div>}
        </div>
        <div class="picker-actions">
          <button id="choose-file-button" class="btn btn-ghost" type="button" onClick={() => electroview.rpc?.send.chooseFile({})}>Choose JSON file…</button>
          {next.canOpenLogFolder && (
            <button class="btn btn-ghost" type="button" onClick={() => electroview.rpc?.send.openLogFolder({})}>Open log folder</button>
          )}
          <button class="btn btn-primary" type="button" disabled={validSelectedId === undefined} onClick={openSelected}>Open</button>
        </div>
      </main>
    </div>
  );
}

function SessionRow({ session, selected, onSelect }: { session: SessionPickerItem; selected: boolean; onSelect(): void }) {
  return (
    <button
      type="button"
      class={selected ? "session-row selected" : "session-row"}
      disabled={session.disabled}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span class="session-heading">
        <span class="session-time">
          {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.createdAt))}
        </span>
        {session.active && <span class="pill active-badge">Active</span>}
      </span>
      <span class="session-summary">{session.summary}</span>
    </button>
  );
}

render(<App />, document.getElementById("root")!);
