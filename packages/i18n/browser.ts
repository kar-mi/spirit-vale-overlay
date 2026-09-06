import { createTranslator, type Translator } from "./translate.ts";

/** The shared English translator. */
export const translator: Translator = createTranslator();

export function useTranslator(): Translator {
  return translator;
}
