import type { PartialMessages } from "../messages.ts";

/**
 * Example german locale, deliberately not registered in `locale.ts` — the app offers English only at the moment.
 * Register it there to switch it on. Everything it omits falls back to English. Will need a full translation before it can be used in production.
 */
export const de: PartialMessages = {
  "settings.general.label": "Allgemein",
};
