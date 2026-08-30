import { expect, test } from "bun:test";
import { DEFAULT_LOCALE, LOCALE_OPTIONS, LOCALES, isLocaleCode, normalizeLocale, type LocaleCode } from "./locale.ts";
import { en } from "./locales/en.ts";
import { sameLocalizedText } from "./messages.ts";

test("normalizes a known code", () => {
  expect(normalizeLocale("en")).toBe("en");
});

test("normalizes case and region variants to the base language", () => {
  expect(normalizeLocale("EN")).toBe("en");
  expect(normalizeLocale("en-GB")).toBe("en");
  expect(normalizeLocale(" en_US ")).toBe("en");
});

test("falls back for anything unrecognized so a newer settings file still loads", () => {
  expect(normalizeLocale("de")).toBe(DEFAULT_LOCALE);
  expect(normalizeLocale("")).toBe(DEFAULT_LOCALE);
  expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE);
  expect(normalizeLocale(42)).toBe(DEFAULT_LOCALE);
});

test("isLocaleCode rejects inherited object keys", () => {
  expect(isLocaleCode("toString")).toBe(false);
  expect(isLocaleCode("en")).toBe(true);
});

test("every registered locale is offered in the picker", () => {
  expect([...LOCALE_OPTIONS.map((option) => option.value)].sort()).toEqual([...Object.keys(LOCALES)].sort() as LocaleCode[]);
});

test("the default locale is registered", () => {
  expect(Object.keys(LOCALES)).toContain(DEFAULT_LOCALE);
});

test("plural keys come in matched one/other pairs", () => {
  for (const key of Object.keys(en)) {
    if (key.endsWith(".one")) expect(Object.hasOwn(en, `${key.slice(0, -4)}.other`)).toBe(true);
  }
});

test("sameLocalizedText compares code and params", () => {
  expect(sameLocalizedText({ code: "capture.status.active" }, { code: "capture.status.active" })).toBe(true);
  expect(sameLocalizedText({ code: "capture.status.active" }, { code: "capture.status.stopped" })).toBe(false);
  expect(sameLocalizedText(undefined, { code: "capture.status.active" })).toBe(false);
  expect(sameLocalizedText(undefined, undefined)).toBe(true);
  expect(sameLocalizedText(
    { code: "settings.search.empty", params: { query: "a" } },
    { code: "settings.search.empty", params: { query: "b" } },
  )).toBe(false);
});
