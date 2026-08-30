import { expect, test } from "bun:test";
import { createTranslator } from "./translate.ts";
import type { LocaleCode } from "./locale.ts";
import type { MessageKey } from "./messages.ts";

test("returns the catalog entry for a known key", () => {
  expect(createTranslator("en")("settings.general.label")).toBe("General");
});

test("substitutes named placeholders", () => {
  expect(createTranslator("en")("settings.overlay.elements.displayFor", { element: "Minimap" }))
    .toBe("Display for Minimap");
});

test("leaves a placeholder alone when no value is supplied", () => {
  expect(createTranslator("en")("settings.overlay.elements.displayFor")).toBe("Display for {element}");
});

test("falls back to the key itself rather than throwing", () => {
  expect(createTranslator("en")("nope.not.a.key" as MessageKey)).toBe("nope.not.a.key");
});

test("plural picks the one/other variant and interpolates the count", () => {
  const t = createTranslator("en");
  expect(t.plural("settings.search.summary", 0)).toBe("0 settings found.");
  expect(t.plural("settings.search.summary", 1)).toBe("1 setting found.");
  expect(t.plural("settings.search.summary", 2)).toBe("2 settings found.");
});

test("text translates backend-produced LocalizedText", () => {
  const t = createTranslator("en");
  expect(t.text({ code: "capture.status.active" })).toBe("Capture Active");
  expect(t.text({ code: "settings.search.empty", params: { query: "zoom" } })).toBe("No settings match “zoom”.");
});

test("text passes undefined through so optional warnings stay optional", () => {
  expect(createTranslator("en").text(undefined)).toBeUndefined();
});

test("exposes the locale it was built for", () => {
  expect(createTranslator("en").locale).toBe("en");
});

test("an unrecognized locale falls back to English rather than rendering keys", () => {
  const t = createTranslator("de" as LocaleCode);
  expect(t("settings.general.label")).toBe("General");
  expect(t.text({ code: "capture.status.active" })).toBe("Capture Active");
  expect(t.plural("settings.search.summary", 2)).toBe("2 settings found.");
});
