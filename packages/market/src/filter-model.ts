import type { MarketUiFilter } from "./app-types.ts";

export function validateMarketUiFilters(
  candidate: readonly MarketUiFilter[],
  statCount: number,
): MarketUiFilter[] {
  const result: MarketUiFilter[] = [];
  const seen = new Set<number>();
  for (const filter of candidate) {
    if (!Number.isSafeInteger(filter.stat) || filter.stat < 0 || filter.stat >= statCount) {
      throw new Error("unknown market stat filter");
    }
    if (seen.has(filter.stat)) throw new Error("duplicate market stat filter");
    if (filter.minValue !== undefined && !Number.isFinite(filter.minValue)) {
      throw new Error("market stat minimum must be finite");
    }
    if (filter.maxValue !== undefined && !Number.isFinite(filter.maxValue)) {
      throw new Error("market stat maximum must be finite");
    }
    if (filter.minValue !== undefined && filter.maxValue !== undefined && filter.minValue > filter.maxValue) {
      throw new Error("market stat minimum exceeds maximum");
    }
    seen.add(filter.stat);
    result.push({ ...filter });
  }
  return result;
}
