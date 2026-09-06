# @svoverlay/i18n

Message catalogs and the translator. No dependencies — it is imported by the Bun backend and by
every browser bundle alike.

## Locales

English is the only supported locale. The translator still routes every string through the
catalog so a locale can be re-added later: add `locales/<code>.ts` as a `PartialMessages` and
register it in `locale.ts` (`LOCALES`), then reintroduce a picker and the window-broadcast
plumbing. `PartialMessages` permits missing keys but rejects unknown ones, so a misspelled key
fails `bun run typecheck`.

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
params — and is translated where it is shown with `t.text(value)`. Tests assert on stable codes
instead of English sentences, and this keeps the door open for re-adding a locale later.

Backend code imports that shared runtime from `@svoverlay/i18n/backend`: use `translate(...)`
for native surfaces, `translateText(...)` when backend code must render a `LocalizedText`, and
`message(...)` / `countedMessage(...)` for deferred text sent to a view.

**Diagnostic logs use `englishText(...)`, never `translateText(...)`.** The two are equivalent
today, but keeping the call explicit means a re-added locale never leaks into support logs.

## Known gaps

- About a dozen `Intl.NumberFormat`/`DateTimeFormat` sites pass `undefined` and so follow the
  OS locale rather than a fixed one.
- Skill, status, monster and class display names come from the `@kar-mi/spirit-vale-tools-*`
  packages and are not translatable from here. So are session summaries, the character window's
  `statusDetail`, and the build-export notes: each arrives as composed English and is rendered as-is.
- `overlay.personal.unit` is a static "DPS", and correctly so: `meter-presentation.ts` reads the
  personal summary from `record.dps` whatever the meter's stat type, so the tile always shows damage.
  Not a mislabelled string — change the presentation first if that should follow the meter.
