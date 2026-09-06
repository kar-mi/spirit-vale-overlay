import { DEFAULT_LOCALE, type LocaleCode } from "./locale.ts";
import { en } from "./locales/en.ts";
import type { LocalizedText, MessageKey, MessageParams, PluralKey } from "./messages.ts";

export interface Translator {
  (key: MessageKey, params?: MessageParams): string;
  readonly locale: LocaleCode;
  text(value: LocalizedText): string;
  text(value: LocalizedText | undefined): string | undefined;
  /** Picks `<key>.one` or `<key>.other`; `count` is available to interpolation. */
  plural(key: PluralKey, count: number, params?: MessageParams): string;
}

const PLACEHOLDER = /\{(\w+)\}/gu;

export function createTranslator(locale: LocaleCode = DEFAULT_LOCALE): Translator {
  const catalog: Record<string, string | undefined> = en;
  const pluralRules = new Intl.PluralRules(DEFAULT_LOCALE);

  // Never throws: an unknown key renders as itself.
  function translate(key: MessageKey, params?: MessageParams): string {
    return interpolate(catalog[key] ?? key, params);
  }

  function text(value: LocalizedText | undefined): string | undefined {
    if (!value) return undefined;
    return value.count === undefined
      ? translate(value.code as MessageKey, value.params)
      : plural(value.code as PluralKey, value.count, value.params);
  }

  function plural(key: PluralKey, count: number, params?: MessageParams): string {
    const template = catalog[`${key}.${pluralRules.select(count)}`] ?? catalog[`${key}.other`] ?? key;
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
