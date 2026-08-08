import { describe, expect, test } from "bun:test";

import { hasMoreListings, MARKET_PAGE_SIZE, MAX_VISIBLE_LISTINGS, nextVisibleLimit } from "./market-paging.ts";

describe("market paging", () => {
  test("reveals one page at a time and stops at the cap", () => {
    let limit = MARKET_PAGE_SIZE;
    while (limit < MAX_VISIBLE_LISTINGS) limit = nextVisibleLimit(limit);
    expect(limit).toBe(MAX_VISIBLE_LISTINGS);
    expect(nextVisibleLimit(limit)).toBe(MAX_VISIBLE_LISTINGS);
  });

  test("hides Load more once the cap is reached even with matches left", () => {
    expect(hasMoreListings(600, MARKET_PAGE_SIZE)).toBe(true);

    let limit = MARKET_PAGE_SIZE;
    while (hasMoreListings(600, limit)) limit = nextVisibleLimit(limit);

    expect(limit).toBe(MAX_VISIBLE_LISTINGS);
    expect(hasMoreListings(600, limit)).toBe(false);
  });

  test("hides Load more when every match is visible", () => {
    expect(hasMoreListings(30, MARKET_PAGE_SIZE)).toBe(false);
    expect(hasMoreListings(MARKET_PAGE_SIZE, MARKET_PAGE_SIZE)).toBe(false);
  });
});
