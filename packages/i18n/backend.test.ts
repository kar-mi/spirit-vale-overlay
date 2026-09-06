import { expect, test } from "bun:test";

import { countedMessage, englishText, message, translate, translateText } from "./backend.ts";

test("immediately translates backend-owned text", () => {
  expect(translate("settings.general.label")).toBe("General");
});

test("keeps RPC messages deferred while translating them on demand", () => {
  const text = message("settings.search.empty", { query: "zoom" });
  expect(text).toEqual({ code: "settings.search.empty", params: { query: "zoom" } });
  expect(translateText(text)).toBe("No settings match “zoom”.");
  expect(englishText(text)).toBe("No settings match “zoom”.");
  expect(countedMessage("settings.search.summary", 2)).toEqual({ code: "settings.search.summary", count: 2 });
});
