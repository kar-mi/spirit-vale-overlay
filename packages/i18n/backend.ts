import { localized, localizedCount, type LocalizedText, type MessageKey, type MessageParams, type PluralKey } from "./messages.ts";
import { createTranslator, type Translator } from "./translate.ts";

const translator: Translator = createTranslator();

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

/** Renders `LocalizedText` in English for diagnostic logs. Kept distinct from `translateText` so
 * callers stay explicit about intent even though English is now the only locale. */
export function englishText(value: LocalizedText): string;
export function englishText(value: LocalizedText | undefined): string | undefined;
export function englishText(value: LocalizedText | undefined): string | undefined {
  return translator.text(value);
}

/** Creates deferred RPC text that will be translated by the receiving view. */
export function message(code: MessageKey, params?: MessageParams): LocalizedText {
  return localized(code, params);
}

/** Creates deferred counted RPC text that will be pluralized by the receiving view. */
export function countedMessage(code: PluralKey, count: number, params?: MessageParams): LocalizedText {
  return localizedCount(code, count, params);
}
