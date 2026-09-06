import { en } from "./locales/en.ts";
import type { PartialMessages } from "./messages.ts";

/** English is the only supported locale. Adding one back: add a catalog and an entry here. */
export const LOCALES = { en } satisfies Record<string, PartialMessages>;

export type LocaleCode = keyof typeof LOCALES;

export const DEFAULT_LOCALE: LocaleCode = "en";

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === "string" && Object.hasOwn(LOCALES, value);
}

/** Unknown codes fall back, so an old settings file with a dropped locale still loads. */
export function normalizeLocale(value: unknown): LocaleCode {
  if (typeof value !== "string") return DEFAULT_LOCALE;
  const trimmed = value.trim();
  if (isLocaleCode(trimmed)) return trimmed;
  const normalized = trimmed.replaceAll("_", "-").toLowerCase();
  const normalizedMatch = Object.keys(LOCALES).find((code) => code.toLowerCase() === normalized);
  if (normalizedMatch) return normalizedMatch as LocaleCode;
  const base = normalized.split("-")[0];
  return isLocaleCode(base) ? base : DEFAULT_LOCALE;
}
