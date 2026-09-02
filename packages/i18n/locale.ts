import { en } from "./locales/en.ts";
import { zhTW } from "./locales/zh-TW.ts";
import type { PartialMessages } from "./messages.ts";

/** Adding a language: import its catalog and add one entry here and in LOCALE_OPTIONS. */
export const LOCALES = { en, "zh-TW": zhTW } satisfies Record<string, PartialMessages>;

export type LocaleCode = keyof typeof LOCALES;

export const DEFAULT_LOCALE: LocaleCode = "en";

/** Endonyms, never translated: the reader may not read the current language. */
export const LOCALE_OPTIONS: readonly { value: LocaleCode; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh-TW", label: "繁體中文" },
];

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === "string" && Object.hasOwn(LOCALES, value);
}

/** Unknown codes fall back, so a settings file from a newer build still loads. */
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
