import { afterEach, expect, test } from "bun:test";

import { backendLocale, countedMessage, message, setBackendLocale, translate, translateText } from "./backend.ts";

afterEach(() => { setBackendLocale("en"); });

test("centralizes the backend locale and immediate translation", () => {
  expect(setBackendLocale("EN")).toBe("en");
  expect(backendLocale()).toBe("en");
  expect(translate("settings.general.label")).toBe("General");
  expect(setBackendLocale("not-installed")).toBe("en");
});

test("keeps RPC messages deferred while translating them on demand", () => {
  const text = message("settings.search.empty", { query: "zoom" });
  expect(text).toEqual({ code: "settings.search.empty", params: { query: "zoom" } });
  expect(translateText(text)).toBe("No settings match “zoom”.");
  expect(countedMessage("settings.search.summary", 2)).toEqual({ code: "settings.search.summary", count: 2 });
});
