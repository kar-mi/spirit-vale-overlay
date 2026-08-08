import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import type { FishNetActiveStatus } from "@kar-mi/spirit-vale-tools-combat";
import { resolveFishNetSkill } from "@kar-mi/spirit-vale-tools-skills";
import { loadBundledStatusCatalog } from "@kar-mi/spirit-vale-tools-statuses";

import {
  SUMMON_OPTIONS,
  missingRequiredStatuses,
  normalizeRequiredStatusIds,
  requiredStatusOptions,
} from "./required-statuses.ts";

const STATUS_ICON_DIRECTORY = path.join(import.meta.dir, "..", "..", "..", "apps", "launcher", "assets", "status-icons");

function activeStatus(statusId: string): FishNetActiveStatus {
  return { statusId, displayName: statusId, isDebuff: false, level: 1, appliedAtMs: 0 };
}

describe("required status options", () => {
  test("offers both categories with renderable, non-overlapping statuses", () => {
    const buffs = requiredStatusOptions("buffs");
    const toggles = requiredStatusOptions("toggles");

    expect(buffs.length).toBeGreaterThan(0);
    expect(toggles.length).toBeGreaterThan(0);
    // Statuses without shipped artwork are dropped from the overlay, so arming one would leave a
    // warning the user could never clear.
    for (const option of [...buffs, ...toggles]) expect(option.spriteId).toBeTruthy();

    const toggleIds = new Set(toggles.map((option) => option.statusId));
    expect(buffs.filter((option) => toggleIds.has(option.statusId))).toEqual([]);
  });

  test("every offered status has artwork the overlay can actually render", () => {
    // A cell whose icon fails to load is dropped from the tile, which would leave an armed warning
    // permanently unclearable. This is what keeps e.g. SummonMount out of the curated summon list.
    const withoutArtwork = [...requiredStatusOptions("buffs"), ...requiredStatusOptions("toggles")]
      .filter((option) => !existsSync(path.join(STATUS_ICON_DIRECTORY, `${option.spriteId}.webp`)))
      .map((option) => `${option.statusId} (${option.spriteId})`);

    expect(withoutArtwork).toEqual([]);
  });

  test("offers the curated summons in the toggles picker", () => {
    const toggleIds = new Set(requiredStatusOptions("toggles").map((option) => option.statusId));

    for (const option of SUMMON_OPTIONS) expect(toggleIds).toContain(option.statusId);
  });

  test("curated summon rows still match the skill catalog", () => {
    // The rows are inlined to keep the skill catalog out of the renderer bundle, so an upstream
    // rename or retirement has to fail here rather than drift silently.
    for (const option of SUMMON_OPTIONS) {
      expect(resolveFishNetSkill(option.statusId)).toMatchObject({
        displayName: option.displayName,
        spriteId: option.spriteId,
      });
    }
  });

  test("curated summon ids do not collide with catalog statuses", () => {
    const statusIds = new Set(loadBundledStatusCatalog().statuses.map((definition) => definition.id));

    expect(SUMMON_OPTIONS.filter((option) => statusIds.has(option.statusId))).toEqual([]);
  });

  test("normalization drops unknown ids, cross-category ids and non-strings", () => {
    const buffId = requiredStatusOptions("buffs")[0]!.statusId;
    const toggleId = requiredStatusOptions("toggles")[0]!.statusId;

    expect(normalizeRequiredStatusIds("buffs", [buffId, toggleId, "NotARealStatus", 3, null]))
      .toEqual([buffId]);
    expect(normalizeRequiredStatusIds("toggles", [toggleId, buffId])).toEqual([toggleId]);
    expect(normalizeRequiredStatusIds("buffs", "Aegis")).toEqual([]);
    expect(normalizeRequiredStatusIds("buffs", undefined)).toEqual([]);
  });

  test("normalization dedupes and sorts", () => {
    const [first, second] = requiredStatusOptions("buffs").map((option) => option.statusId);
    const expected = [first!, second!].sort();

    expect(normalizeRequiredStatusIds("buffs", [second, first, second])).toEqual(expected);
  });
});

describe("missingRequiredStatuses", () => {
  test("reports armed statuses that are not active", () => {
    const active = [activeStatus("Aegis"), activeStatus("Barrier")];

    expect(missingRequiredStatuses(["Aegis", "Blessing", "Barrier"], active)).toEqual(["Blessing"]);
  });

  test("reports nothing when every armed status is active", () => {
    expect(missingRequiredStatuses(["Aegis"], [activeStatus("Aegis")])).toEqual([]);
  });

  test("reports nothing when no status is armed, even with nothing active", () => {
    expect(missingRequiredStatuses([], [])).toEqual([]);
  });

  test("reports every armed status when nothing is active", () => {
    expect(missingRequiredStatuses(["Aegis", "Blessing"], [])).toEqual(["Aegis", "Blessing"]);
  });
});
