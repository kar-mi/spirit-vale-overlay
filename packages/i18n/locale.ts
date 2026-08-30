import { en } from "./locales/en.ts";
import type { PartialMessages } from "./messages.ts";

/** Adding a language: import its catalog and add one entry here and in LOCALE_OPTIONS. */
export const LOCALES = { en } satisfies Record<string, PartialMessages>;

export type LocaleCode = keyof typeof LOCALES;

export const DEFAULT_LOCALE: LocaleCode = "en";

/** Endonyms, never translated: the reader may not read the current language. */
export const LOCALE_OPTIONS: readonly { value: LocaleCode; label: string }[] = [
  { value: "en", label: "English" },
];

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === "string" && Object.hasOwn(LOCALES, value);
}

/** Unknown codes fall back, so a settings file from a newer build still loads. */
export function normalizeLocale(value: unknown): LocaleCode {
  if (typeof value !== "string") return DEFAULT_LOCALE;
  const trimmed = value.trim();
  if (isLocaleCode(trimmed)) return trimmed;
  const lowered = trimmed.toLowerCase();
  if (isLocaleCode(lowered)) return lowered;
  const base = lowered.split(/[-_]/u)[0];
  return isLocaleCode(base) ? base : DEFAULT_LOCALE;
}
