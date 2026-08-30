import { de } from "./locales/de.ts";
import { en } from "./locales/en.ts";
import type { PartialMessages } from "./messages.ts";

/** Adding a language: import its catalog and add one entry here and in LOCALE_OPTIONS. */
export const LOCALES = { en, de } satisfies Record<string, PartialMessages>;

export type LocaleCode = keyof typeof LOCALES;

export const DEFAULT_LOCALE: LocaleCode = "en";

/**
 * Names are endonyms and are never translated — someone hunting for their language has to
 * recognise it while the interface is still in one they cannot read.
 */
export const LOCALE_OPTIONS: readonly { value: LocaleCode; label: string }[] = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
];

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === "string" && Object.hasOwn(LOCALES, value);
}

/** Unknown codes fall back rather than throw, so a settings file from a newer build still loads. */
export function normalizeLocale(value: unknown): LocaleCode {
  if (typeof value !== "string") return DEFAULT_LOCALE;
  const trimmed = value.trim();
  if (isLocaleCode(trimmed)) return trimmed;
  const lowered = trimmed.toLowerCase();
  if (isLocaleCode(lowered)) return lowered;
  const base = lowered.split(/[-_]/u)[0];
  return isLocaleCode(base) ? base : DEFAULT_LOCALE;
}
