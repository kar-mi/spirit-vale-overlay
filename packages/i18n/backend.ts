import { DEFAULT_LOCALE, normalizeLocale, type LocaleCode } from "./locale.ts";
import { localized, localizedCount, type LocalizedText, type MessageKey, type MessageParams, type PluralKey } from "./messages.ts";
import { createTranslator, type Translator } from "./translate.ts";

let locale: LocaleCode = DEFAULT_LOCALE;
let translator: Translator = createTranslator(locale);
const english: Translator = createTranslator(DEFAULT_LOCALE);

/** The locale used by backend-owned surfaces and newly created windows. */
export function backendLocale(): LocaleCode {
  return locale;
}

/** Updates the single backend translator, normalizing unknown locale values to English. */
export function setBackendLocale(value: unknown): LocaleCode {
  const next = normalizeLocale(value);
  if (next !== locale) {
    locale = next;
    translator = createTranslator(next);
  }
  return next;
}

/** Immediately translates text rendered by the backend, such as native menus and dialogs. */
export function translate(key: MessageKey, params?: MessageParams): string {
  return translator(key, params);
}

/** Immediately translates deferred text when a backend-owned surface needs to log or show it. */
export function translateText(value: LocalizedText): string;
export function translateText(value: LocalizedText | undefined): string | undefined;
export function translateText(value: LocalizedText | undefined): string | undefined {
  return translator.text(value);
}

/**
 * Renders `LocalizedText` in English regardless of the current locale, for diagnostic logs. Support
 * reads those logs; they must not arrive in whatever language the player happened to pick.
 */
export function englishText(value: LocalizedText): string;
export function englishText(value: LocalizedText | undefined): string | undefined;
export function englishText(value: LocalizedText | undefined): string | undefined {
  return english.text(value);
}

/** Creates deferred RPC text that will be translated by the receiving view. */
export function message(code: MessageKey, params?: MessageParams): LocalizedText {
  return localized(code, params);
}

/** Creates deferred counted RPC text that will be pluralized by the receiving view. */
export function countedMessage(code: PluralKey, count: number, params?: MessageParams): LocalizedText {
  return localizedCount(code, count, params);
}
