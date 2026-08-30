import {
  catalogItemType,
  marketListingKey,
  parseFishNetMarketStats,
  resolveFishNetMarketListingDisplayName,
  type FishNetMarketEvent,
  type FishNetMarketListing,
} from "@kar-mi/spirit-vale-tools-market";
import {
  canonicalObservationPayload,
  sha256Hex,
  type MarketUploadObservation,
  type MarketUploadStat,
} from "./contracts.ts";

export async function normalizeMarketEvent(
  event: FishNetMarketEvent,
  capturedAt = new Date(),
): Promise<MarketUploadObservation[]> {
  let listings: FishNetMarketListing[];
  if (event.kind === "searchPage") {
    if (!event.page.success) return [];
    listings = event.page.listings;
  } else if (event.kind === "stallListings") {
    listings = (event.listings ?? []).filter((listing): listing is FishNetMarketListing => listing !== null);
  } else {
    return [];
  }

  const observations: MarketUploadObservation[] = [];
  for (const listing of listings) {
    const observation = await normalizeListing(listing, capturedAt);
    if (observation !== undefined) observations.push(observation);
  }
  return observations;
}

export async function normalizeListing(
  listing: FishNetMarketListing,
  capturedAt = new Date(),
): Promise<MarketUploadObservation | undefined> {
  if (listing.item.itemId === null) return undefined;
  const listingVersion = safeBigInt(listing.version, "listing version");
  const unitPrice = safeBigInt(listing.unitPrice, "unit price");
  if (!Number.isSafeInteger(listing.item.itemType) || listing.item.itemType < 0) throw new Error("market item type is invalid");
  if (!Number.isSafeInteger(listing.availableQuantity) || listing.availableQuantity < 0) throw new Error("market quantity is invalid");
  if (!Number.isSafeInteger(listing.status) || listing.status < 0) throw new Error("market status is invalid");

  const parsedStats = parseFishNetMarketStats(
    listing.item.payloadJson,
    catalogItemType(listing.item.itemType),
    listing.item.itemId,
  ) ?? [];
  const stats: MarketUploadStat[] = parsedStats.map((stat) => ({
    type: stat.type,
    ...(stat.name === undefined ? {} : { name: stat.name }),
    ...(stat.value === undefined ? {} : { value: stat.value }),
    percent: stat.percent,
  }));
  const observedAt = listing.updatedAt > 0n
    ? unixSecondsToIso(listing.updatedAt, "listing update")
    : capturedAt.toISOString();
  const expiresAt = listing.expiresAt > 0n
    ? unixSecondsToIso(listing.expiresAt, "listing expiry")
    : null;
  const observation: MarketUploadObservation = {
    reportId: crypto.randomUUID(),
    listingKey: await sha256Hex(marketListingKey(listing)),
    listingVersion,
    payloadHash: "",
    itemType: listing.item.itemType,
    itemId: listing.item.itemId,
    displayName: resolveFishNetMarketListingDisplayName(listing),
    unitPrice,
    quantity: listing.availableQuantity,
    status: listing.status,
    stats,
    observedAt,
    expiresAt,
  };
  observation.payloadHash = await sha256Hex(canonicalObservationPayload(observation));
  return observation;
}

function safeBigInt(value: bigint, label: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds the upload safe-integer contract`);
  return Number(value);
}

function unixSecondsToIso(value: bigint, label: string): string {
  const seconds = safeBigInt(value, label);
  const milliseconds = seconds * 1_000;
  if (!Number.isSafeInteger(milliseconds)) throw new Error(`${label} exceeds the JavaScript timestamp range`);
  const timestamp = new Date(milliseconds);
  if (!Number.isFinite(timestamp.getTime())) throw new Error(`${label} is invalid`);
  return timestamp.toISOString();
}
