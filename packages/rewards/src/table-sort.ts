import type { RewardsUiKill, RewardsUiMob, RewardsUiSummary } from "./app-types.ts";

export type SortDirection = "ascending" | "descending";
export type SummarySortKey = "displayName" | "level" | "kills" | "experience" | "jobExperience" | "coins";
export type KillSortKey = "displayName" | "level" | "timestamp" | "experience" | "jobExperience" | "coins";
export type CatalogSortKey = "displayName" | "id" | "level" | "boss" | "baseExperience" | "baseCoins";

export interface TableSort<K extends string> { key: K; direction: SortDirection }

export function sortRewardSummaries(rows: readonly RewardsUiSummary[], sort: TableSort<SummarySortKey>): RewardsUiSummary[] {
  return sortRows(rows, sort.direction, (left, right) => compareReward(left, right, sort.key), (row) => `${row.displayName}:${row.mobId}`);
}

export function sortRewardKills(rows: readonly RewardsUiKill[], sort: TableSort<KillSortKey>): RewardsUiKill[] {
  if (sort.key === "timestamp") {
    const factor = sort.direction === "ascending" ? 1 : -1;
    return [...rows].sort((left, right) => {
      if (left.timestamp === undefined && right.timestamp === undefined) return `${left.displayName}:${left.id}`.localeCompare(`${right.displayName}:${right.id}`);
      if (left.timestamp === undefined) return 1;
      if (right.timestamp === undefined) return -1;
      const comparison = timestampValue(left.timestamp) - timestampValue(right.timestamp);
      return comparison * factor || `${left.displayName}:${left.id}`.localeCompare(`${right.displayName}:${right.id}`);
    });
  }
  return sortRows(rows, sort.direction, (left, right) => compareReward(left, right, sort.key), (row) => `${row.displayName}:${row.id}`);
}

export function sortRewardCatalog(rows: readonly RewardsUiMob[], sort: TableSort<CatalogSortKey>): RewardsUiMob[] {
  return sortRows(rows, sort.direction, (left, right) => {
    if (sort.key === "displayName" || sort.key === "id") return left[sort.key].localeCompare(right[sort.key]);
    if (sort.key === "boss") return Number(left.boss) - Number(right.boss);
    return left[sort.key] - right[sort.key];
  }, (row) => `${row.displayName}:${row.id}`);
}

function compareReward<T extends RewardsUiSummary | RewardsUiKill>(left: T, right: T, key: SummarySortKey | KillSortKey): number {
  if (key === "displayName") return left.displayName.localeCompare(right.displayName);
  if (key === "coins") return compareBigInt(left.coins, right.coins);
  return (left[key as keyof T] as number) - (right[key as keyof T] as number);
}

function sortRows<T>(rows: readonly T[], direction: SortDirection, compare: (left: T, right: T) => number, identity: (row: T) => string): T[] {
  const factor = direction === "ascending" ? 1 : -1;
  return [...rows].sort((left, right) => compare(left, right) * factor || identity(left).localeCompare(identity(right)));
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

function timestampValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
