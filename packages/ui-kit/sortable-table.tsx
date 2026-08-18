import type { ComponentChildren } from "preact";

export type SortDirection = "ascending" | "descending";

export interface TableSort<K extends string> {
  key: K;
  direction: SortDirection;
}

type TableSortValue = number | string | undefined;

export function nextTableSort<K extends string>(
  current: TableSort<K>,
  key: K,
  initialDirection: SortDirection = "descending",
): TableSort<K> {
  return {
    key,
    direction: current.key === key
      ? (current.direction === "descending" ? "ascending" : "descending")
      : initialDirection,
  };
}

/** Returns a sorted copy while keeping unavailable values at the bottom in either direction. */
export function sortTableRows<T, K extends string>(
  rows: readonly T[],
  sort: TableSort<K>,
  valueFor: (row: T, key: K) => TableSortValue,
  tieBreak: (left: T, right: T) => number,
): T[] {
  return [...rows].sort((left, right) => {
    const difference = compareTableValues(valueFor(left, sort.key), valueFor(right, sort.key), sort.direction);
    if (difference !== 0) return difference;
    return tieBreak(left, right);
  });
}

function compareTableValues(left: TableSortValue, right: TableSortValue, direction: SortDirection): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  const difference = typeof left === "string" && typeof right === "string"
    ? left.localeCompare(right)
    : Number(left) - Number(right);
  return direction === "ascending" ? difference : -difference;
}

interface SortableHeaderProps<K extends string> {
  children: ComponentChildren;
  sortKey: K;
  sort: TableSort<K>;
  onSort(key: K): void;
  align?: "start" | "end";
}

export function SortableHeader<K extends string>({
  children,
  sortKey,
  sort,
  onSort,
  align = "end",
}: SortableHeaderProps<K>) {
  const active = sort.key === sortKey;
  return (
    <th class="sortable-column" aria-sort={active ? sort.direction : undefined}>
      <button
        class={`sort-button${align === "start" ? " align-start" : ""}`}
        type="button"
        onClick={() => onSort(sortKey)}
      >
        <span>{children}</span>
        <span class={active ? "sort-indicator active" : "sort-indicator"} aria-hidden="true">
          {active ? (sort.direction === "descending" ? "▼" : "▲") : "↕"}
        </span>
      </button>
    </th>
  );
}
