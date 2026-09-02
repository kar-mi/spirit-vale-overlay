import { signal } from "@preact/signals";

import { DEFAULT_LOCALE, normalizeLocale, type LocaleCode } from "./locale.ts";
import { createTranslator, type Translator } from "./translate.ts";

/** The locale this window is showing. Read it during render to re-render on a language change. */
export const activeLocale = signal<LocaleCode>(DEFAULT_LOCALE);

const translators = new Map<LocaleCode, Translator>();

/** Reads `activeLocale`, so a component calling this re-renders when the language changes. */
export function useTranslator(): Translator {
  const locale = activeLocale.value;
  let translator = translators.get(locale);
  if (!translator) {
    translator = createTranslator(locale);
    translators.set(locale, translator);
  }
  return translator;
}

export function setActiveLocale(value: unknown): void {
  const next = normalizeLocale(value);
  activeLocale.value = next;
  if (typeof document !== "undefined") document.documentElement.lang = next;
}

// How the backend pushes a language change into an already-open window.
(globalThis as typeof globalThis & { __svoSetLocale?: (value: unknown) => void }).__svoSetLocale = setActiveLocale;
