import type { en } from "./locales/en.ts";

export type MessageKey = keyof typeof en;

/** The complete catalog. Only English has to satisfy this. */
export type Messages = Record<MessageKey, string>;

/** A contributed locale: missing keys fall back to English, unknown keys fail `tsc`. */
export type PartialMessages = Partial<Messages>;

export type MessageParams = Record<string, string | number>;

type PluralStem<K> = K extends `${infer Stem}.other` ? Stem : never;

/** Stems of keys carrying `.one`/`.other` variants. */
export type PluralKey = PluralStem<MessageKey>;

/** Text produced outside a renderer, translated where it is shown. */
export interface LocalizedText {
  code: MessageKey;
  params?: MessageParams;
}

export function localized(code: MessageKey, params?: MessageParams): LocalizedText {
  return params ? { code, params } : { code };
}

export function sameLocalizedText(a: LocalizedText | undefined, b: LocalizedText | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.code !== b.code) return false;
  return JSON.stringify(a.params ?? null) === JSON.stringify(b.params ?? null);
}
