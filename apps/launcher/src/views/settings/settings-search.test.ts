import { describe, expect, test } from "bun:test";
import { createTranslator } from "@svoverlay/i18n/translate";
import { filterSettingsSections, normalizeSettingsSearch } from "./settings-search.ts";

const t = createTranslator("en");

const sections = [
  {
    id: "network",
    label: "Network",
    description: "Npcap capture configuration.",
    items: [
      { id: "adapter", searchText: "Network adapter automatic saved capture device" },
      { id: "refresh", searchText: "Refresh capture devices get Npcap download" },
    ],
  },
  {
    id: "combat",
    label: "Combat",
    description: "Control how combat tracking behaves.",
    items: [
      { id: "reset-gold", searchText: "Reset gold on map channel change all-time tracker" },
      { id: "personal-dps", searchText: "Personal DPS display encounter average live recent rate" },
    ],
  },
] as const;

describe("settings search", () => {
  test("normalizes case and surrounding whitespace", () => {
    expect(normalizeSettingsSearch("  Reset   GOLD ")).toEqual(["reset", "gold"]);
  });

  test("matches item labels and keywords case-insensitively", () => {
    expect(filterSettingsSections("ADAPTER", sections)).toEqual([
      { sectionId: "network", itemIds: ["adapter"] },
    ]);
  });

  test("requires every query word to match the same setting", () => {
    expect(filterSettingsSections("reset gold", sections)).toEqual([
      { sectionId: "combat", itemIds: ["reset-gold"] },
    ]);
    expect(filterSettingsSections("adapter gold", sections)).toEqual([]);
  });

  test("a category match returns all settings in that category", () => {
    expect(filterSettingsSections("network", sections)).toEqual([
      { sectionId: "network", itemIds: ["adapter", "refresh"] },
    ]);
  });

  test("returns no groups for an empty or unmatched query", () => {
    expect(filterSettingsSections("   ", sections)).toEqual([]);
    expect(filterSettingsSections("audio", sections)).toEqual([]);
  });

  // Guards the catalog's own keywords, which are what the shipped Language section searches on.
  test("the language setting is reachable by the words people would type", () => {
    const languageSection = [{
      id: "language",
      label: t("settings.language.label"),
      description: t("settings.language.description"),
      items: [{ id: "display-language", searchText: t("settings.language.select.search") }],
    }];
    for (const query of ["language", "locale", "translation", "english"]) {
      expect(filterSettingsSections(query, languageSection)).toEqual([
        { sectionId: "language", itemIds: ["display-language"] },
      ]);
    }
  });
});
