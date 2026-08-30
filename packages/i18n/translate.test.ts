import { expect, test } from "bun:test";
import { createTranslator } from "./translate.ts";
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

test("uses a locale's own translation where it has one", () => {
  expect(createTranslator("de")("settings.general.label")).toBe("Allgemein");
  expect(createTranslator("de")("settings.language.label")).toBe("Sprache");
});

test("falls back to English for every key a locale has not translated", () => {
  const de = createTranslator("de");
  expect(de("settings.network.label")).toBe("Network");
  expect(de("settings.minimap.enabled.label")).toBe("Enable the minimap");
  expect(de.text({ code: "capture.status.active" })).toBe("Capture Active");
  expect(de.plural("settings.search.summary", 2)).toBe("2 settings found.");
});
