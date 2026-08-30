# @svoverlay/i18n

Message catalogs and the translator. No dependencies — it is imported by the Bun backend and by
every browser bundle alike.

## Adding a language

1. Add `locales/<code>.ts` with as many or as few keys as you have:
   ```ts
   import type { PartialMessages } from "../messages.ts";
   export const de: PartialMessages = { "settings.general.label": "Allgemein" };
   ```
2. Register it in `locale.ts` — one entry in `LOCALES`, one in `LOCALE_OPTIONS`.

`locales/de.ts` is a one-key example of step 1 without step 2: it typechecks, but the app does
not offer it.

**English is always the fallback.** A locale supplies whatever it has translated; every key it
omits renders the English string, so a translation can land a few strings at a time and the UI
never shows a blank or a raw key. `PartialMessages` permits missing keys but rejects unknown
ones, so a misspelled key fails `bun run typecheck`.

Locale names in `LOCALE_OPTIONS` are endonyms — "Deutsch", never "German". Someone hunting for
their language has to recognise it while the interface is still in one they cannot read.

## Writing keys

Keys read `<area>.<feature>.<element>`. A settings item contributes `.label`, optionally `.hint`,
and a `.search` bag of synonyms. **Translate the `.search` bags** — they are what the settings
search matches against, so leaving them in English silently breaks search in that locale.

Interpolation is `{name}` placeholders, deliberately not ICU MessageFormat; nothing in this app
has needed more. Counted text uses `.one`/`.other` variants addressed by stem:

```ts
t("settings.search.empty", { query });        // "No settings match “zoom”."
t.plural("settings.search.summary", count);   // "1 setting found." / "2 settings found."
```

Nothing here throws. An unknown key falls back to English and then renders as the key itself,
which is loud in review and harmless in play.

## Text from the backend

The backend has no renderer, so status and warning text travels as `LocalizedText` — a key plus
params — and is translated where it is shown with `t.text(value)`. A language change then
re-renders instantly with no backend round-trip, and tests assert on stable codes instead of
English sentences. Surfaces the OS owns (tray menu, window titles, native dialogs) have no
renderer at all and use a backend-side translator built from the persisted setting.

## Known gaps

- `normalizeSettingsSearch` splits queries on whitespace, which will not serve CJK locales.
- About a dozen `Intl.NumberFormat`/`DateTimeFormat` sites still pass `undefined` and so follow
  the OS locale rather than this setting.
- Skill, status, monster and class display names come from the `@kar-mi/spirit-vale-tools-*`
  packages and are not translatable from here.
