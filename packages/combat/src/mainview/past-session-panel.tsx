import { spiritValeLocationKey, type SpiritValeLocation } from "@svoverlay/desktop-platform/location";
import type { SessionPickerItem, SessionPickerState } from "@svoverlay/desktop-platform/session-picker-types";
import type { SessionDateRange } from "@svoverlay/desktop-platform/session-summary-journal";
import { CheckboxMultiSelect, type CheckboxMultiSelectOption } from "@svoverlay/ui-kit/checkbox-multi-select";
import { useEffect, useState } from "preact/hooks";
import { formatZone, formatZoneSummary } from "../zone-label.ts";

type DateBoundary = "from" | "to";
type Meridiem = "AM" | "PM";

interface PastSessionPanelProps {
  state: SessionPickerState;
  onRefresh(): void;
  onOpenSession(id: string): void;
  onChooseFile(): void;
  onOpenLogFolder(): void;
  onDateRangeChange(value: SessionDateRange): void;
  onZonesChange(zones: string[]): void;
}

export function PastSessionPanel({
  state,
  onRefresh,
  onOpenSession,
  onChooseFile,
  onOpenLogFolder,
  onDateRangeChange,
  onZonesChange,
}: PastSessionPanelProps) {
  const [fromDate, setFromDate] = useState(() => localDateValue(state.dateRange?.fromMs));
  const [fromTime, setFromTime] = useState(() => localTimeParts(state.dateRange?.fromMs).time);
  const [fromMeridiem, setFromMeridiem] = useState<Meridiem>(() => localTimeParts(state.dateRange?.fromMs).meridiem);
  const [toDate, setToDate] = useState(() => localDateValue(state.dateRange?.toMs));
  const [toTime, setToTime] = useState(() => localTimeParts(state.dateRange?.toMs).time);
  const [toMeridiem, setToMeridiem] = useState<Meridiem>(() => localTimeParts(state.dateRange?.toMs).meridiem);
  const [openCalendar, setOpenCalendar] = useState<DateBoundary | undefined>();

  const zoneOptions = zoneOptionsOf(state.zoneFilter?.available ?? []);
  const selectedZones = new Set(state.zoneFilter?.selected ?? []);

  useEffect(() => {
    setFromDate(localDateValue(state.dateRange?.fromMs));
    setFromTime(localTimeParts(state.dateRange?.fromMs).time);
    setFromMeridiem(localTimeParts(state.dateRange?.fromMs).meridiem);
    setToDate(localDateValue(state.dateRange?.toMs));
    setToTime(localTimeParts(state.dateRange?.toMs).time);
    setToMeridiem(localTimeParts(state.dateRange?.toMs).meridiem);
  }, [state.dateRange?.fromMs, state.dateRange?.toMs]);

  useEffect(() => {
    if (openCalendar === undefined) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) {
        setOpenCalendar(undefined);
        return;
      }
      if (event.target.closest(".desktop-calendar, .date-field")) return;
      setOpenCalendar(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenCalendar(undefined);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openCalendar]);

  const applyCustomRange = () => {
    const fromMs = localDateAndTimeMs(fromDate, fromTime, fromMeridiem, "start");
    const toMs = localDateAndTimeMs(toDate, toTime, toMeridiem, "end");
    onDateRangeChange({
      ...(fromMs === undefined ? {} : { fromMs }),
      ...(toMs === undefined ? {} : { toMs }),
    });
  };

  const clearFilters = () => {
    setFromDate("");
    setFromTime("");
    setToDate("");
    setToTime("");
    setOpenCalendar(undefined);
    onDateRangeChange({});
    if (selectedZones.size > 0) onZonesChange([]);
  };

  const invalidFromTime = Boolean(fromTime) && parseTwelveHourTime(normalizeTimeText(fromTime), fromMeridiem) === undefined;
  const invalidToTime = Boolean(toTime) && parseTwelveHourTime(normalizeTimeText(toTime), toMeridiem) === undefined;

  return (
    <section class="past-session-panel">
      <div class="picker-intro">
        <div>
          <h1>Recent sessions</h1>
          <p class={`picker-status is-${state.status}`} aria-live="polite">{state.statusDetail}</p>
        </div>
        <button class="btn" type="button" onClick={onRefresh}>Refresh</button>
      </div>
      <div class="past-date-filter" aria-label="Filter past sessions by date, time and zone">
        <div class="date-filter-heading">
          <span>Date range</span>
          <span class="date-filter-summary">{dateRangeSummary(state.dateRange)}</span>
        </div>
        <div class="custom-date-range">
          <div class="date-boundary">
            <span class="date-boundary-label">From</span>
            <button class={`date-field${openCalendar === "from" ? " is-open" : ""}`} type="button" aria-expanded={openCalendar === "from"} onClick={() => setOpenCalendar(openCalendar === "from" ? undefined : "from")}>
              <CalendarIcon />
              <span>{formattedDraftDate(fromDate) || "Choose date"}</span>
            </button>
            <div class={`typed-time${invalidFromTime ? " is-invalid" : ""}`}>
              <label><span class="sr-only">From time</span><input type="text" inputMode="numeric" maxLength={5} placeholder="h:mm" value={fromTime} disabled={!fromDate} aria-invalid={invalidFromTime} onInput={(event) => setFromTime(formatTimeInput(event.currentTarget.value))} onBlur={() => setFromTime(normalizeTimeText(fromTime))} /></label>
              <MeridiemPicker value={fromMeridiem} disabled={!fromDate} onChange={setFromMeridiem} />
            </div>
            {openCalendar === "from" && (
              <DesktopCalendar
                value={fromDate}
                onSelect={(value) => {
                  setFromDate(value);
                  setOpenCalendar(undefined);
                }}
              />
            )}
          </div>
          <span class="date-range-arrow" aria-hidden="true">→</span>
          <div class="date-boundary">
            <span class="date-boundary-label">To</span>
            <button class={`date-field${openCalendar === "to" ? " is-open" : ""}`} type="button" aria-expanded={openCalendar === "to"} onClick={() => setOpenCalendar(openCalendar === "to" ? undefined : "to")}>
              <CalendarIcon />
              <span>{formattedDraftDate(toDate) || "Choose date"}</span>
            </button>
            <div class={`typed-time${invalidToTime ? " is-invalid" : ""}`}>
              <label><span class="sr-only">To time</span><input type="text" inputMode="numeric" maxLength={5} placeholder="h:mm" value={toTime} disabled={!toDate} aria-invalid={invalidToTime} onInput={(event) => setToTime(formatTimeInput(event.currentTarget.value))} onBlur={() => setToTime(normalizeTimeText(toTime))} /></label>
              <MeridiemPicker value={toMeridiem} disabled={!toDate} onChange={setToMeridiem} />
            </div>
            {openCalendar === "to" && (
              <DesktopCalendar
                value={toDate}
                onSelect={(value) => {
                  setToDate(value);
                  setOpenCalendar(undefined);
                }}
              />
            )}
          </div>
          <div class="date-filter-actions">
            <button class="btn btn-ghost" type="button" disabled={!fromDate && !toDate && !hasDateRange(state.dateRange) && selectedZones.size === 0} onClick={clearFilters}>Clear</button>
            <button class="btn apply-date-range" type="button" disabled={(!fromDate && !toDate) || invalidFromTime || invalidToTime} onClick={applyCustomRange}>Apply</button>
          </div>
        </div>
        {zoneOptions.length > 0 && (
          <div class="zone-filter">
            <span class="date-boundary-label">Zones</span>
            <CheckboxMultiSelect
              options={zoneOptions}
              selected={selectedZones}
              onChange={(next) => onZonesChange([...next])}
              ariaLabel="Filter by zone"
              searchPlaceholder="Search zones"
              clearLabel="Clear filter"
              noMatchLabel={(query) => `No zones match "${query}".`}
              summarize={zoneSelectionSummary}
            />
          </div>
        )}
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

function CalendarIcon() {
  return <svg class="calendar-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 2.5v3m9-3v3M3 7.5h14M4.5 4h11A1.5 1.5 0 0 1 17 5.5v10a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-10A1.5 1.5 0 0 1 4.5 4Z" /></svg>;
}

function zoneOptionsOf(available: readonly SpiritValeLocation[]): CheckboxMultiSelectOption<string>[] {
  return available
    .map((location) => ({ value: spiritValeLocationKey(location), label: formatZone(location) }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function zoneSelectionSummary(
  selected: ReadonlySet<string>,
  options: readonly CheckboxMultiSelectOption<string>[],
): string {
  if (selected.size === 0) return "All zones";
  return selected.size === 1
    ? options.find((option) => selected.has(option.value))?.label ?? "1 zone"
    : `${selected.size} zones`;
}

function MeridiemPicker({ value, disabled, onChange }: { value: Meridiem; disabled: boolean; onChange(value: Meridiem): void }) {
  return (
    <div class="meridiem-picker" role="group" aria-label="AM or PM">
      {(["AM", "PM"] as const).map((option) => <button type="button" class={value === option ? "is-active" : ""} disabled={disabled} aria-pressed={value === option} onClick={() => onChange(option)}>{option}</button>)}
    </div>
  );
}

function localDateValue(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "";
  const date = new Date(value);
  const local = new Date(value - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function localTimeParts(value: number | undefined): { time: string; meridiem: Meridiem } {
  if (value === undefined || !Number.isFinite(value)) return { time: "", meridiem: "AM" };
  const date = new Date(value);
  const meridiem: Meridiem = date.getHours() >= 12 ? "PM" : "AM";
  const hour = date.getHours() % 12 || 12;
  return { time: `${hour}:${String(date.getMinutes()).padStart(2, "0")}`, meridiem };
}

function localDateAndTimeMs(date: string, time: string, meridiem: Meridiem, boundary: "start" | "end"): number | undefined {
  if (!date) return undefined;
  const parsedTime = time ? parseTwelveHourTime(normalizeTimeText(time), meridiem) : boundary === "start" ? { hour: 0, minute: 0 } : { hour: 23, minute: 59 };
  if (parsedTime === undefined) return undefined;
  const parsed = new Date(`${date}T${String(parsedTime.hour).padStart(2, "0")}:${String(parsedTime.minute).padStart(2, "0")}${boundary === "end" ? ":59.999" : ""}`).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseTwelveHourTime(value: string, meridiem: Meridiem): { hour: number; minute: number } | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const hour12 = Number(match[1]);
  const minute = Number(match[2]);
  if (hour12 < 1 || hour12 > 12 || minute < 0 || minute > 59) return undefined;
  return { hour: hour12 % 12 + (meridiem === "PM" ? 12 : 0), minute };
}

export function formatTimeInput(value: string): string {
  const compact = value.trim().replace(/\s+/g, "");
  if (compact.includes(":")) {
    const [hour = "", minute = ""] = compact.split(":", 2);
    const hourDigits = hour.replace(/\D/g, "").slice(0, 2);
    const minuteDigits = minute.replace(/\D/g, "");
    if (minuteDigits.length <= 2) return `${hourDigits}:${minuteDigits}`;
    return formatCompactTime(`${hourDigits}${minuteDigits}`);
  }
  return formatCompactTime(compact.replace(/\D/g, ""));
}

function formatCompactTime(value: string): string {
  const digits = value.slice(0, 4);
  if (digits.length <= 2) return digits;
  if (digits.length === 3) return `${digits.slice(0, 1)}:${digits.slice(1)}`;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

export function normalizeTimeText(value: string): string {
  const compact = formatTimeInput(value);
  const match = /^(\d{1,2})(?::(\d{0,2}))?$/.exec(compact);
  if (!match) return value;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  if (hour < 1 || hour > 12 || minute > 59) return value;
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

function formattedDraftDate(value: string): string {
  if (!value) return "";
  const date = dateFromValue(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date) : "";
}

function hasDateRange(value: SessionDateRange | undefined): boolean {
  return value?.fromMs !== undefined || value?.toMs !== undefined;
}

function dateRangeSummary(value: SessionDateRange | undefined): string {
  if (!hasDateRange(value)) return "Showing every session";
  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  if (value?.fromMs !== undefined && value.toMs !== undefined) return `${formatter.format(value.fromMs)} – ${formatter.format(value.toMs)}`;
  if (value?.fromMs !== undefined) return `After ${formatter.format(value.fromMs)}`;
  return `Before ${formatter.format(value!.toMs!)}`;
}

function DesktopCalendar({ value, onSelect }: { value: string; onSelect(value: string): void }) {
  const selected = value ? dateFromValue(value) : new Date();
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(visibleMonth);
  const gridStart = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1 - visibleMonth.getDay());
  const days = Array.from({ length: 42 }, (_, index) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index));
  const todayValue = dateValue(new Date());
  return (
    <div class="desktop-calendar" role="dialog" aria-label="Choose a date">
      <div class="calendar-header">
        <button type="button" aria-label="Previous month" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}>‹</button>
        <strong>{monthLabel}</strong>
        <button type="button" aria-label="Next month" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}>›</button>
      </div>
      <div class="calendar-weekdays" aria-hidden="true">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span>{day}</span>)}</div>
      <div class="calendar-days">
        {days.map((day) => {
          const dayValue = dateValue(day);
          const outside = day.getMonth() !== visibleMonth.getMonth();
          return <button type="button" class={`${outside ? "is-outside " : ""}${dayValue === value ? "is-selected " : ""}${dayValue === todayValue ? "is-today" : ""}`} aria-label={new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(day)} aria-pressed={dayValue === value} onClick={() => onSelect(dayValue)}>{day.getDate()}</button>;
        })}
      </div>
    </div>
  );
}

function dateFromValue(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
}

function dateValue(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
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
