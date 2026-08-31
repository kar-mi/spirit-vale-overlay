export const DEFAULT_HISTORY_SESSION_LIMIT = 100;
export const MIN_HISTORY_SESSION_LIMIT = 100;
export const MAX_HISTORY_SESSION_LIMIT = 100_000;

export function normalizeHistorySessionLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_HISTORY_SESSION_LIMIT;
  return Math.min(MAX_HISTORY_SESSION_LIMIT, Math.max(MIN_HISTORY_SESSION_LIMIT, Math.round(value)));
}

export function historyScanLimit(limit: number): number {
  return normalizeHistorySessionLimit(limit) * 3;
}
