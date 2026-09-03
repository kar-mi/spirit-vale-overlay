const integerFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });
const chanceFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 });

export function formatInteger(value: number | bigint): string {
  return integerFormat.format(value);
}

export function formatCompact(value: number): string {
  return compactFormat.format(value);
}

export function formatPercent(value: number): string {
  return percentFormat.format(value);
}

export function formatChance(value: number): string {
  return `${chanceFormat.format(value)}%`;
}

export function safeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function formatDps(value: number): string {
  return value >= 10_000 ? compactFormat.format(value) : integerFormat.format(value);
}

export function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Bytes are always whole, and past three digits a decimal is noise rather than precision.
  const decimals = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(decimals)} ${BYTE_UNITS[unit]}`;
}

export function formatMeasuredAt(iso: string, now = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "unknown";
  const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (at.toDateString() === now.toDateString()) return time;
  return `${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}
