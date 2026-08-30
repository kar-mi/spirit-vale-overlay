import { describe, expect, test } from "bun:test";
import type { FishNetMarketEvent, FishNetMarketListing } from "@kar-mi/spirit-vale-tools-market";
import { normalizeListing, normalizeMarketEvent } from "./normalizer.ts";

const BASE_LISTING: FishNetMarketListing = {
  listingId: "listing-private-id",
  sellerAccountId: "seller-private-account",
  sellerDisplayName: "Seller Secret",
  itemDisplayName: "Moonstone",
  item: {
    itemId: "moonstone",
    instanceId: "instance-private-id",
    itemType: 4,
    quantity: 3,
    payloadJson: null,
    payloadSchemaVersion: null,
    compatibilityFingerprint: null,
  },
  initialQuantity: 3,
  availableQuantity: 2,
  soldQuantity: 1,
  unitPrice: 1250n,
  status: 1,
  version: 7n,
  createdAt: 1_700_000_000n,
  updatedAt: 1_700_000_010n,
  expiresAt: 1_700_086_400n,
};

describe("market normalization", () => {
  test("emits only the public listing contract", async () => {
    const event: FishNetMarketEvent = {
      kind: "searchPage",
      tick: 42,
      page: {
        success: true,
        code: 0,
        message: null,
        listings: [BASE_LISTING],
        nextCursor: null,
        hasMore: false,
      },
    };

    const observations = await normalizeMarketEvent(event, new Date("2025-01-01T00:00:00.000Z"));
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      listingVersion: 7,
      itemType: 4,
      itemId: "moonstone",
      displayName: "Moonstone",
      unitPrice: 1250,
      quantity: 2,
      status: 1,
      stats: [],
      observedAt: "2023-11-14T22:13:30.000Z",
      expiresAt: "2023-11-15T22:13:20.000Z",
    });
    expect(observations[0]?.listingKey).toMatch(/^[0-9a-f]{64}$/);
    expect(observations[0]?.payloadHash).toMatch(/^[0-9a-f]{64}$/);

    const serialized = JSON.stringify(observations[0]);
    expect(serialized).not.toContain("seller-private-account");
    expect(serialized).not.toContain("Seller Secret");
    expect(serialized).not.toContain("instance-private-id");
    expect(serialized).not.toContain("payloadJson");
  });

  test("rejects bigint values outside the upload safe-integer contract", async () => {
    await expect(normalizeListing({ ...BASE_LISTING, unitPrice: BigInt(Number.MAX_SAFE_INTEGER) + 1n }))
      .rejects.toThrow("unit price exceeds the upload safe-integer contract");
  });

  test("ignores unsuccessful searches and private overview events", async () => {
    const failedSearch: FishNetMarketEvent = {
      kind: "searchPage",
      tick: 1,
      page: { success: false, code: 1, message: "failed", listings: [BASE_LISTING], nextCursor: null, hasMore: false },
    };
    const overview: FishNetMarketEvent = {
      kind: "overview",
      tick: 2,
      overview: {
        pendingCoins: 0n,
        mailboxItems: null,
        mailboxHasMore: false,
        transactions: null,
        transactionsHaveMore: false,
        ownListings: [BASE_LISTING],
        ownListingsHaveMore: false,
        code: 0,
        reason: 0,
        message: null,
      },
    };

    expect(await normalizeMarketEvent(failedSearch)).toEqual([]);
    expect(await normalizeMarketEvent(overview)).toEqual([]);
  });
});
