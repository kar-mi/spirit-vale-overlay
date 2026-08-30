import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CapturedFishNetPacket } from "@kar-mi/spirit-vale-tools-capture";
import type { FishNetMarketEvent, FishNetMarketListing } from "@kar-mi/spirit-vale-tools-market";
import { MarketContributor } from "./contributor.ts";
import type { MarketObservationBatch } from "./contracts.ts";

let temporaryRoot: string | undefined;

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

describe("market contributor", () => {
  test("registers once and uploads a 50-observation public batch", async () => {
    const statePath = await createStatePath();
    const requests: Array<{ url: string; body?: string }> = [];
    const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      requests.push({ url, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
      if (url.endsWith("/v2/installations")) return Response.json({ token: "a".repeat(43) }, { status: 201 });
      return new Response(null, { status: 202 });
    };
    const contributor = await MarketContributor.load({
      statePath,
      enabled: true,
      collectorVersion: "test-collector",
      endpoint: "https://market.test",
      fetch: fakeFetch as typeof fetch,
      now: () => new Date("2025-01-01T00:00:00.000Z"),
    });
    let sequence = 0;
    trackerOf(contributor).consume = () => [searchEvent(sequence++)];

    for (let index = 0; index < 50; index += 1) contributor.consume({} as CapturedFishNetPacket);
    await contributor.shutdown();

    expect(requests.map((request) => request.url)).toEqual([
      "https://market.test/v2/installations",
      "https://market.test/v2/observations",
    ]);
    const upload = JSON.parse(requests[1]!.body!) as MarketObservationBatch;
    expect(upload.protocolVersion).toBe(2);
    expect(upload.collector.version).toBe("test-collector");
    expect(upload.observations).toHaveLength(50);
    expect(JSON.stringify(upload)).not.toContain("seller-account");
    expect(JSON.stringify(upload)).not.toContain("Seller Secret");
    expect(JSON.stringify(upload)).not.toContain("raw");

    const state = JSON.parse(await readFile(statePath, "utf8")) as { installationToken: string; outbox: unknown[] };
    expect(state.installationToken).toBe("a".repeat(43));
    expect(state.outbox).toEqual([]);
  });

  test("keeps a failed batch durably queued for a later launch", async () => {
    const statePath = await createStatePath();
    const contributor = await MarketContributor.load({
      statePath,
      enabled: true,
      collectorVersion: "test-collector",
      endpoint: "https://market.test",
      fetch: (async (input: string | URL | Request) => String(input).endsWith("/v2/installations")
        ? Response.json({ token: "b".repeat(43) }, { status: 201 })
        : new Response(null, { status: 503 })) as typeof fetch,
    });
    let sequence = 0;
    trackerOf(contributor).consume = () => [searchEvent(sequence++)];

    for (let index = 0; index < 50; index += 1) contributor.consume({} as CapturedFishNetPacket);
    await contributor.shutdown();

    const state = JSON.parse(await readFile(statePath, "utf8")) as { outbox: Array<{ attempts: number; batch: MarketObservationBatch }> };
    expect(state.outbox).toHaveLength(1);
    expect(state.outbox[0]?.attempts).toBe(1);
    expect(state.outbox[0]?.batch.observations).toHaveLength(50);
  });

  test("opt-out drops queued observations before any upload", async () => {
    const statePath = await createStatePath();
    let requests = 0;
    const contributor = await MarketContributor.load({
      statePath,
      enabled: true,
      collectorVersion: "test-collector",
      endpoint: "https://market.test",
      fetch: (async (_input: string | URL | Request, _init?: RequestInit) => { requests += 1; return new Response(null, { status: 500 }); }) as typeof fetch,
    });
    trackerOf(contributor).consume = () => [searchEvent(1)];

    contributor.consume({} as CapturedFishNetPacket);
    contributor.setEnabled(false);
    await contributor.shutdown();

    expect(requests).toBe(0);
    const state = JSON.parse(await readFile(statePath, "utf8")) as { outbox: unknown[] };
    expect(state.outbox).toEqual([]);
  });
});

interface MarketContributorInternals {
  tracker: { consume(packet: CapturedFishNetPacket): FishNetMarketEvent[] };
}

function trackerOf(contributor: MarketContributor): MarketContributorInternals["tracker"] {
  // The tracker is intentionally private; this test replaces only its decoder boundary.
  const internals = contributor as unknown as MarketContributorInternals;
  return internals.tracker;
}

function searchEvent(sequence: number): FishNetMarketEvent {
  return {
    kind: "searchPage",
    tick: sequence,
    page: {
      success: true,
      code: 0,
      message: null,
      listings: [listing(sequence)],
      nextCursor: null,
      hasMore: false,
    },
  };
}

function listing(sequence: number): FishNetMarketListing {
  return {
    listingId: `listing-${sequence}`,
    sellerAccountId: `seller-account-${sequence}`,
    sellerDisplayName: "Seller Secret",
    itemDisplayName: "Moonstone",
    item: {
      itemId: "moonstone",
      instanceId: `instance-${sequence}`,
      itemType: 4,
      quantity: 2,
      payloadJson: null,
      payloadSchemaVersion: null,
      compatibilityFingerprint: null,
    },
    initialQuantity: 2,
    availableQuantity: 2,
    soldQuantity: 0,
    unitPrice: BigInt(1000 + sequence),
    status: 1,
    version: BigInt(sequence + 1),
    createdAt: 1_700_000_000n,
    updatedAt: 1_700_000_010n,
    expiresAt: 1_700_086_400n,
  };
}

async function createStatePath(): Promise<string> {
  temporaryRoot ??= await mkdtemp(path.join(tmpdir(), "spiritvale-market-contributor-"));
  return path.join(temporaryRoot, "market-contributor.json");
}
