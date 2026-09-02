import { signal } from "@preact/signals";
import { render } from "preact";
import { useState } from "preact/hooks";
import { DesktopView } from "@svoverlay/desktop-runtime/view";
import { TitleBar } from "@svoverlay/ui-kit/title-bar";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { disableWebChrome } from "@svoverlay/ui-kit/disable-web-chrome";
import { SettingsButton } from "@svoverlay/ui-kit/settings-button";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";
import type { SessionPickerItem, SessionPickerRpc, SessionPickerState } from "@svoverlay/desktop-platform/session-picker-types";
import { activeLocale, useTranslator } from "@svoverlay/i18n/browser";
import { createTranslator } from "@svoverlay/i18n/translate";

const state = signal<SessionPickerState | undefined>(undefined);
// `document.title` is set outside the render tree, so it reads the locale signal directly.
function applyState(next: SessionPickerState): void {
  state.value = next;
  document.title = createTranslator(activeLocale.value).text(next.title);
}
const rpc = DesktopView.defineRPC<SessionPickerRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => applyState(repairRendererPayload(next)) } },
});
const desktopView = new DesktopView({ rpc });
void desktopView.rpc?.request.getState({}).then((next) => applyState(repairRendererPayload(next)));

const SESSION_PICKER_DEFAULT_WIDTH = 640;
const SESSION_PICKER_DEFAULT_HEIGHT = 560;
disableWebChrome();
void ensureInitialWindowSize(desktopView.rpc?.request, { width: 480, height: 400 });

function App() {
  const t = useTranslator();
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const next = state.value;
  if (!next) return <div class="picker-shell" />;

  const validSelectedId = next.sessions.some((session) => session.id === selectedId && !session.disabled) ? selectedId : undefined;

  function openSession(id: string): void {
    if (id) desktopView.rpc?.send.openSession({ id });
  }

  function openSelected(): void {
    if (validSelectedId) openSession(validSelectedId);
  }

  return (
    <div class="picker-shell">
      <TitleBar
        appTag={t.text(next.title)}
        minWidth={480}
        minHeight={400}
        getFrame={async () => (await desktopView.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: SESSION_PICKER_DEFAULT_WIDTH, height: SESSION_PICKER_DEFAULT_HEIGHT }}
        setFrame={(frame) => void desktopView.rpc?.request.setWindowFrame(frame)}
        onMinimize={() => desktopView.rpc?.send.windowAction({ action: "minimize" })}
        onClose={() => desktopView.rpc?.send.windowAction({ action: "close" })}
        extraControls={<SettingsButton onClick={() => desktopView.rpc?.send.openSettings({})} />}
      />
      <main>
        <div class="picker-intro">
          <div>
            <h1>{t("sessions.heading")}</h1>
            <p class={`picker-status is-${next.status}`} aria-live="polite">{t.text(next.statusDetail)}</p>
          </div>
          <button class="btn" type="button" onClick={() => desktopView.rpc?.send.refresh({})}>{t("sessions.refresh")}</button>
        </div>
        <div class="session-list" role="listbox" aria-label={t("sessions.listLabel")}>
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
              ? <div class="empty-state">{t("sessions.loading")}</div>
              : <div class="empty-state">{t(next.status === "error" ? "sessions.errorHint" : "sessions.emptyHint")}</div>}
        </div>
        <div class="picker-actions">
          <button id="choose-file-button" class="btn btn-ghost" type="button" onClick={() => desktopView.rpc?.send.chooseFile({})}>{t("sessions.chooseFile")}</button>
          {next.canOpenLogFolder && (
            <button class="btn btn-ghost" type="button" onClick={() => desktopView.rpc?.send.openLogFolder({})}>{t("sessions.openFolder")}</button>
          )}
          <button class="btn btn-primary" type="button" disabled={validSelectedId === undefined} onClick={openSelected}>{t("sessions.open")}</button>
        </div>
      </main>
    </div>
  );
}

function SessionRow({ session, selected, onSelect }: { session: SessionPickerItem; selected: boolean; onSelect(): void }) {
  const t = useTranslator();
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
        {session.active && <span class="pill active-badge">{t("sessions.active")}</span>}
      </span>
      <span class="session-summary">{session.summary ?? t("sessions.summaryUnavailable")}</span>
    </button>
  );
}

render(<App />, document.getElementById("root")!);
