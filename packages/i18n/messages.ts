import type { en } from "./locales/en.ts";

export type MessageKey = keyof typeof en;

/** The complete catalog. Only English has to satisfy this — it is the fallback for everything else. */
export type Messages = Record<MessageKey, string>;

/**
 * What a contributed locale supplies. Keys may be missing — those fall back to English at
 * runtime — but every key present must be a real one, so typos still fail `tsc`.
 */
export type PartialMessages = Partial<Messages>;

export type MessageParams = Record<string, string | number>;

type PluralStem<K> = K extends `${infer Stem}.other` ? Stem : never;

/** Keys that carry `.one`/`.other` variants, addressed by their stem through `t.plural`. */
export type PluralKey = PluralStem<MessageKey>;

/** Text produced outside a renderer — it travels as a key and is translated where it is shown. */
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
