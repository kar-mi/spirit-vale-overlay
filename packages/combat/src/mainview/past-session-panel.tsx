import { useTranslator } from "@svoverlay/i18n/browser";
import type { SessionPickerItem, SessionPickerState } from "@svoverlay/desktop-platform/session-picker-types";
import { formatZone, formatZoneSummary } from "../zone-label.ts";

interface PastSessionPanelProps {
  state: SessionPickerState;
  onRefresh(): void;
  onOpenSession(id: string): void;
  onChooseFile(): void;
  onOpenLogFolder(): void;
}

export function PastSessionPanel({
  state,
  onRefresh,
  onOpenSession,
  onChooseFile,
  onOpenLogFolder,
}: PastSessionPanelProps) {
  const t = useTranslator();
  return (
    <section class="past-session-panel">
      <div class="picker-intro">
        <div>
          <h1>{t("sessions.heading")}</h1>
          <p class={`picker-status is-${state.status}`} aria-live="polite">{t.text(state.statusDetail)}</p>
        </div>
        <button class="btn" type="button" onClick={onRefresh}>{t("sessions.refresh")}</button>
      </div>
      <div class="session-list" role="list" aria-label={t("sessions.listLabel")}>
        {state.sessions.length > 0
          ? state.sessions.map((session) => (
              <div class="session-list-item" role="listitem" key={session.id}>
                <SessionRow
                  session={session}
                  onOpen={() => onOpenSession(session.id)}
                />
              </div>
            ))
          : state.status === "loading"
            ? <div class="empty-state">{t("sessions.loading")}</div>
            : <div class="empty-state">{state.status === "error" ? t("sessions.errorHint") : t("sessions.emptyHint")}</div>}
      </div>
      <div class="picker-actions">
        <button class="btn btn-ghost" type="button" onClick={onChooseFile}>{t("sessions.chooseFile")}</button>
        {state.canOpenLogFolder && (
          <button class="btn btn-ghost" type="button" onClick={onOpenLogFolder}>{t("sessions.openFolder")}</button>
        )}
      </div>
    </section>
  );
}

function SessionRow({ session, onOpen }: { session: SessionPickerItem; onOpen(): void }) {
  const t = useTranslator();
  const locations = session.locations ?? [];
  const zone = formatZoneSummary(locations);
  return (
    <button
      type="button"
      class="session-row"
      disabled={session.disabled}
      onClick={onOpen}
    >
      <span class="session-heading">
        <span class="session-time">
          {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.createdAt))}
        </span>
        {zone && <span class="zone-pill" title={t("sessions.zonesVisited", { zones: locations.map(formatZone).join(", ") })}>{zone}</span>}
        {session.active && <span class="pill active-badge">{t("sessions.active")}</span>}
      </span>
      <span class="session-summary">{session.summary ?? t("sessions.summaryUnavailable")}</span>
    </button>
  );
}
