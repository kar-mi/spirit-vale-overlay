import type { SessionPickerItem, SessionPickerState } from "@svoverlay/desktop-platform/session-picker-types";
import type { SessionDateRange } from "@svoverlay/desktop-platform/session-summary-journal";
import { useEffect, useState } from "preact/hooks";
import { formatZone, formatZoneSummary } from "../zone-label.ts";

interface PastSessionPanelProps {
  state: SessionPickerState;
  onRefresh(): void;
  onOpenSession(id: string): void;
  onChooseFile(): void;
  onOpenLogFolder(): void;
  onDateRangeChange(value: SessionDateRange): void;
}

export function PastSessionPanel({
  state,
  onRefresh,
  onOpenSession,
  onChooseFile,
  onOpenLogFolder,
  onDateRangeChange,
}: PastSessionPanelProps) {
  const [from, setFrom] = useState(() => localDateTimeValue(state.dateRange?.fromMs));
  const [to, setTo] = useState(() => localDateTimeValue(state.dateRange?.toMs));

  useEffect(() => {
    setFrom(localDateTimeValue(state.dateRange?.fromMs));
    setTo(localDateTimeValue(state.dateRange?.toMs));
  }, [state.dateRange?.fromMs, state.dateRange?.toMs]);

  const changeRange = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom);
    setTo(nextTo);
    onDateRangeChange({
      ...(localDateTimeMs(nextFrom) === undefined ? {} : { fromMs: localDateTimeMs(nextFrom)! }),
      ...(localDateTimeMs(nextTo) === undefined ? {} : { toMs: localDateTimeMs(nextTo)! + 59_999 }),
    });
  };

  return (
    <section class="past-session-panel">
      <div class="picker-intro">
        <div>
          <h1>Recent sessions</h1>
          <p class={`picker-status is-${state.status}`} aria-live="polite">{state.statusDetail}</p>
        </div>
        <button class="btn" type="button" onClick={onRefresh}>Refresh</button>
      </div>
      <div class="past-date-filter" aria-label="Filter past sessions by date and time">
        <label><span>From</span><input class="input" type="datetime-local" step="60" value={from} onInput={(event) => changeRange(event.currentTarget.value, to)} /></label>
        <label><span>To</span><input class="input" type="datetime-local" step="60" value={to} onInput={(event) => changeRange(from, event.currentTarget.value)} /></label>
        <button class="btn btn-ghost" type="button" disabled={!from && !to} onClick={() => changeRange("", "")}>Clear dates</button>
      </div>
      <div class="session-list" role="list" aria-label="Recent combat sessions">
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
            ? <div class="empty-state">Loading recent sessions…</div>
            : <div class="empty-state">{state.status === "error" ? "Refresh to try scanning again." : "You can still choose a specific JSON file."}</div>}
      </div>
      <div class="picker-actions">
        <button class="btn btn-ghost" type="button" onClick={onChooseFile}>Choose JSON file…</button>
        {state.canOpenLogFolder && (
          <button class="btn btn-ghost" type="button" onClick={onOpenLogFolder}>Open log folder</button>
        )}
      </div>
    </section>
  );
}

function localDateTimeMs(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function localDateTimeValue(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "";
  const date = new Date(value);
  const local = new Date(value - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function SessionRow({ session, onOpen }: { session: SessionPickerItem; onOpen(): void }) {
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
        {zone && <span class="zone-pill" title={`Zones visited: ${locations.map(formatZone).join(", ")}`}>{zone}</span>}
        {session.active && <span class="pill active-badge">Active</span>}
      </span>
      <span class="session-summary">{session.summary}</span>
    </button>
  );
}
