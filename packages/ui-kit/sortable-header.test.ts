import { describe, expect, test } from "bun:test";
import { nextSort, safeDomId } from "./sortable-header.tsx";

describe("nextSort", () => {
  test("defaults a new column to descending and toggles the active column", () => {
    expect(nextSort({ key: "damage", direction: "descending" }, "name")).toEqual({ key: "name", direction: "descending" });
    expect(nextSort({ key: "damage", direction: "descending" }, "damage")).toEqual({ key: "damage", direction: "ascending" });
    expect(nextSort({ key: "damage", direction: "ascending" }, "damage")).toEqual({ key: "damage", direction: "descending" });
  });
});

test("safeDomId replaces characters that are unsafe in generated ids", () => {
  expect(safeDomId("mob:Dark Knight/1")).toBe("mob-Dark-Knight-1");
});
