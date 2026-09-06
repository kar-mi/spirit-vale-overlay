import { describe, expect, test } from "bun:test";
import { filterSettingsSections, normalizeSettingsSearch } from "./settings-search.ts";

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
});
