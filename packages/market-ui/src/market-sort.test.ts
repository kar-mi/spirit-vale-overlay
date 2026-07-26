import { describe, expect, test } from "bun:test";

import type { MarketUiListing } from "./app-types.ts";
import { sortMarketListings } from "./market-sort.ts";

describe("market table sorting", () => {
  test("sorts large prices exactly in both directions", () => {
    const rows = [listing("row-a", "Fictional Widget", "9007199254740993"), listing("row-b", "Synthetic Relic", "12")];
    expect(sortMarketListings(rows, "price", "ascending").map((row) => row.key)).toEqual(["row-b", "row-a"]);
    expect(sortMarketListings(rows, "price", "descending").map((row) => row.key)).toEqual(["row-a", "row-b"]);
  });

  test("sorts text and quantity while keeping missing metadata last", () => {
    const missing = listing("row-c", "Placeholder C", "3");
    const first = { ...listing("row-a", "Placeholder A", "1"), seller: "Merchant Alpha", available: 9 };
    const second = { ...listing("row-b", "Placeholder B", "2"), seller: "Merchant Beta", available: 2 };
    expect(sortMarketListings([missing, second, first], "seller", "descending").map((row) => row.key)).toEqual(["row-b", "row-a", "row-c"]);
    expect(sortMarketListings([missing, second, first], "available", "ascending").map((row) => row.key)).toEqual(["row-c", "row-b", "row-a"]);
  });
});

function listing(key: string, name: string, price: string): MarketUiListing {
  return { key, name, price, available: 0, stats: [] };
}
