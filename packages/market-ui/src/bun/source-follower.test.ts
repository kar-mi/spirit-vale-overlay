import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { marketEventLogData } from "@kar-mi/spirit-vale-tools-market";
import type { FishNetMarketEvent, FishNetMarketListing, FishNetMarketStall } from "@kar-mi/spirit-vale-tools-market";

import { MarketSourceLogFollower } from "./source-follower.ts";

let directory: string;
let logPath: string;
let sequence = 0;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "market-source-"));
  logPath = path.join(directory, "market.jsonl");
  sequence = 0;
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function listing(overrides: Partial<FishNetMarketListing> = {}): FishNetMarketListing {
  return {
    id: "listing-1",
    sellerId: "seller-1",
    sellerName: "Seller One",
    itemId: "iron_sword",
    itemType: 1,
    count: 3,
    countTraded: 0,
    price: 1_200n,
    json: null,
    expiresAt: 0n,
    ...overrides,
  };
}

function stall(overrides: Partial<FishNetMarketStall> = {}): FishNetMarketStall {
  return {
    stallId: "stall-1",
    accountId: "seller-2",
    characterId: "character-2",
    mapId: "Vale",
    slotId: "slot-1",
    expiresAt: 0n,
    hiredAt: 0n,
    shopName: "Bob's Bits",
    characterName: "Bob",
    archetype: 0,
    status: 0,
    version: 1n,
    visualSnapshotJson: null,
    ...overrides,
  };
}

/**
 * Re-attaches the `searchText` that `marketEventLogData` drops.
 *
 * Passive capture writes it — it is the game's own `ItemDisplayName` — but the typed event and its
 * serializer both discard it, so the fixtures have to put it back to match a real log on disk.
 */
function withSearchText(line: string, names: Record<string, string>): string {
  const parsed = JSON.parse(line) as { data: { listings?: Array<{ id: string; searchText?: string }> } };
  for (const listing of parsed.data.listings ?? []) {
    const name = names[listing.id];
    if (name !== undefined) listing.searchText = name;
  }
  return JSON.stringify(parsed);
}

function record(type: string, data: Record<string, unknown>): string {
  return JSON.stringify({
    schemaVersion: 1,
    sessionId: "session-1",
    sequence: ++sequence,
    recordedAt: new Date().toISOString(),
    source: "test",
    type,
    data,
  });
}

function eventRecord(event: FishNetMarketEvent): string {
  return record("market.event", marketEventLogData(event));
}

async function writeLog(lines: string[]): Promise<void> {
  await writeFile(logPath, lines.length === 0 ? "" : `${lines.join("\n")}\n`, "utf8");
}

const catalogEvent = (item: FishNetMarketListing): FishNetMarketEvent => ({
  kind: "catalog",
  tick: 1,
  items: [{ sellerId: item.sellerId, searchText: "Iron Sword", sellerName: item.sellerName, listing: item }],
});

const stallListingsEvent = (items: FishNetMarketListing[]): FishNetMarketEvent => ({
  kind: "listings",
  tick: 2,
  listings: items,
});

describe("MarketSourceLogFollower", () => {
  test("a catalog event populates only the market side", async () => {
    await writeLog([eventRecord(catalogEvent(listing()))]);

    const batch = await new MarketSourceLogFollower(logPath).poll();

    expect(batch.market.map((view) => view.id)).toEqual(["listing-1"]);
    expect(batch.stall).toEqual([]);
    expect(batch.status).toBe("ready");
  });

  test("a stall listings event populates only the stall side", async () => {
    await writeLog([eventRecord(stallListingsEvent([listing({ id: "stall-listing-1", sellerId: "seller-2" })]))]);

    const batch = await new MarketSourceLogFollower(logPath).poll();

    expect(batch.market).toEqual([]);
    expect(batch.stall.map((view) => view.id)).toEqual(["stall-listing-1"]);
  });

  /**
   * The regression this split exists for: upstream's single tracker clears its listing map on every
   * catalog event, so a second market search used to wipe everything captured from stalls.
   */
  test("a later catalog event leaves previously captured stall listings intact", async () => {
    await writeLog([
      eventRecord(catalogEvent(listing())),
      eventRecord(stallListingsEvent([listing({ id: "stall-listing-1", sellerId: "seller-2" })])),
      eventRecord(catalogEvent(listing({ id: "listing-2", price: 900n }))),
    ]);

    const batch = await new MarketSourceLogFollower(logPath).poll();

    expect(batch.stall.map((view) => view.id)).toEqual(["stall-listing-1"]);
    expect(batch.market.map((view) => view.id)).toEqual(["listing-2"]);
  });

  test("stall metadata resolves on both sides", async () => {
    await writeLog([
      eventRecord({ kind: "stalls", tick: 0, stalls: [stall()] }),
      eventRecord(catalogEvent(listing({ id: "listing-1", sellerId: "seller-2" }))),
      eventRecord(stallListingsEvent([listing({ id: "stall-listing-1", sellerId: "seller-2" })])),
    ]);

    const batch = await new MarketSourceLogFollower(logPath).poll();

    expect(batch.market[0]?.shopName).toBe("Bob's Bits");
    expect(batch.market[0]?.mapId).toBe("Vale");
    expect(batch.stall[0]?.shopName).toBe("Bob's Bits");
    expect(batch.stall[0]?.mapId).toBe("Vale");
  });

  /**
   * `Armor_Vit` is a real captured id: the game sends "Endurance Plate" as its display name, but the
   * tracker upserts stall listings with a null name and the bundled catalog files that id under item
   * type 2 while the listing arrives as type 3 — so the name used to fall back to the raw id.
   */
  test("stall listings show the display name the game sent, not the raw id", async () => {
    await writeLog([
      withSearchText(
        eventRecord(stallListingsEvent([listing({ id: "stall-listing-1", itemId: "Armor_Vit", itemType: 3 })])),
        { "stall-listing-1": "Endurance Plate" },
      ),
    ]);

    const batch = await new MarketSourceLogFollower(logPath).poll();

    expect(batch.stall[0]?.displayName).toBe("Endurance Plate");
    expect(batch.stall[0]?.itemId).toBe("Armor_Vit");
  });

  test("a listing with no name from the game still falls back to its id", async () => {
    await writeLog([eventRecord(stallListingsEvent([listing({ id: "stall-listing-1", itemId: "Armor_Vit", itemType: 3 })]))]);

    const batch = await new MarketSourceLogFollower(logPath).poll();

    expect(batch.stall[0]?.displayName).toBe("Armor_Vit");
  });

  test("a name captured once survives later events for the same listing", async () => {
    await writeLog([
      withSearchText(
        eventRecord(stallListingsEvent([listing({ id: "stall-listing-1", itemId: "Auto", itemType: 4 })])),
        { "stall-listing-1": "Blitzcore" },
      ),
      // A refresh of the same stall, this time without the name attached.
      eventRecord(stallListingsEvent([listing({ id: "stall-listing-1", itemId: "Auto", itemType: 4, countTraded: 1 })])),
    ]);

    const batch = await new MarketSourceLogFollower(logPath).poll();

    expect(batch.stall[0]?.displayName).toBe("Blitzcore");
    expect(batch.stall[0]?.countTraded).toBe(1);
  });

  test("malformed lines are counted rather than thrown", async () => {
    await writeLog(["{ not json", record("market.event", { kind: "nonsense" }), eventRecord(catalogEvent(listing()))]);

    const batch = await new MarketSourceLogFollower(logPath).poll();

    expect(batch.invalidLines).toBe(2);
    expect(batch.market).toHaveLength(1);
  });

  test("a truncated log resets both sides", async () => {
    const follower = new MarketSourceLogFollower(logPath);
    await writeLog([
      eventRecord(catalogEvent(listing())),
      eventRecord(stallListingsEvent([listing({ id: "stall-listing-1", sellerId: "seller-2" })])),
    ]);
    const first = await follower.poll();
    expect(first.market).toHaveLength(1);
    expect(first.stall).toHaveLength(1);

    await writeLog([]);
    const second = await follower.poll();

    expect(second.reset).toBe(true);
    expect(second.market).toEqual([]);
    expect(second.stall).toEqual([]);
    expect(second.status).toBe("watching");
  });

  test("a missing log reports the waiting status", async () => {
    const batch = await new MarketSourceLogFollower(path.join(directory, "absent.jsonl")).poll();

    expect(batch.missing).toBe(true);
    expect(batch.status).toBe("waiting");
    expect(batch.market).toEqual([]);
    expect(batch.stall).toEqual([]);
  });
});
