import { DEFAULT_LOCALE, LOCALES, type LocaleCode } from "./locale.ts";
import { en } from "./locales/en.ts";
import type { LocalizedText, MessageKey, MessageParams, PluralKey } from "./messages.ts";

export interface Translator {
  (key: MessageKey, params?: MessageParams): string;
  readonly locale: LocaleCode;
  /** Translate text produced outside the renderer, such as capture status from the backend. */
  text(value: LocalizedText): string;
  text(value: LocalizedText | undefined): string | undefined;
  /** Picks `<key>.one` or `<key>.other` per the locale, with `count` available to interpolation. */
  plural(key: PluralKey, count: number, params?: MessageParams): string;
}

const PLACEHOLDER = /\{(\w+)\}/gu;

export function createTranslator(locale: LocaleCode): Translator {
  const catalog: Record<string, string | undefined> = LOCALES[locale] ?? LOCALES[DEFAULT_LOCALE];
  // English is the only complete catalog, so it backstops every key another locale has not translated.
  const fallback: Record<string, string | undefined> = en;
  const pluralRules = new Intl.PluralRules(locale);
  const lookup = (key: string): string | undefined => catalog[key] ?? fallback[key];

  // Never throws: an unknown key renders as itself, which is obvious in review but harmless in play.
  function translate(key: MessageKey, params?: MessageParams): string {
    return interpolate(lookup(key) ?? key, params);
  }

  function text(value: LocalizedText | undefined): string | undefined {
    return value && translate(value.code, value.params);
  }

  function plural(key: PluralKey, count: number, params?: MessageParams): string {
    const template = lookup(`${key}.${pluralRules.select(count)}`) ?? lookup(`${key}.other`) ?? key;
    return interpolate(template, { count, ...params });
  }

  return Object.assign(translate, { locale, text, plural }) as Translator;
}

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
