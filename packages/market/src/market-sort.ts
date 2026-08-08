import type { MarketUiListing, MarketUiSortDirection, MarketUiSortKey } from "./app-types.ts";

export function sortMarketListings(
  listings: readonly MarketUiListing[],
  key: MarketUiSortKey,
  direction: MarketUiSortDirection,
): MarketUiListing[] {
  return [...listings].sort((left, right) => {
    const comparison = compareListing(left, right, key, direction);
    return comparison || left.key.localeCompare(right.key);
  });
}

function compareListing(
  left: MarketUiListing,
  right: MarketUiListing,
  key: MarketUiSortKey,
  direction: MarketUiSortDirection,
): number {
  const factor = direction === "ascending" ? 1 : -1;
  if (key === "price") return compareBigInt(left.price, right.price) * factor;
  if (key === "available") return (left.available - right.available) * factor;
  if (key === "name") return left.name.localeCompare(right.name) * factor;
  return compareOptionalText(left[key], right[key], factor);
}

function compareBigInt(left: string, right: string): number {
  try {
    const a = BigInt(left);
    const b = BigInt(right);
    return a === b ? 0 : a < b ? -1 : 1;
  } catch {
    return left.localeCompare(right);
  }
}

function compareOptionalText(left: string | undefined, right: string | undefined, factor: number): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return left.localeCompare(right) * factor;
}
