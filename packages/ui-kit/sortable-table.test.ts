import { describe, expect, test } from "bun:test";

import { nextTableSort, sortTableRows, type TableSort } from "./sortable-table.tsx";

interface Row { name: string; value?: number; label: string }

const rows: Row[] = [
  { name: "B", value: 10, label: "beta" },
  { name: "A", value: 10, label: "alpha" },
  { name: "Missing", label: "missing" },
  { name: "Low", value: 2, label: "low" },
];

function sorted(sort: TableSort<"value" | "label">): string[] {
  return sortTableRows(rows, sort, (row, key) => row[key], (left, right) => left.name.localeCompare(right.name))
    .map((row) => row.name);
}

describe("shared table sorting", () => {
  test("sorts numeric values with deterministic ties and missing values last", () => {
    expect(sorted({ key: "value", direction: "descending" })).toEqual(["A", "B", "Low", "Missing"]);
    expect(sorted({ key: "value", direction: "ascending" })).toEqual(["Low", "A", "B", "Missing"]);
  });

  test("sorts text and chooses the requested initial direction", () => {
    expect(sorted({ key: "label", direction: "ascending" })).toEqual(["A", "B", "Low", "Missing"]);
    expect(nextTableSort({ key: "value", direction: "descending" }, "label", "ascending"))
      .toEqual({ key: "label", direction: "ascending" });
    expect(nextTableSort({ key: "label", direction: "ascending" }, "label", "ascending"))
      .toEqual({ key: "label", direction: "descending" });
  });
});
