export type SortDirection = "ascending" | "descending";

export interface TableSort<K extends string> {
  key: K;
  direction: SortDirection;
}

export function nextSort<K extends string>(current: TableSort<K>, key: K): TableSort<K> {
  return {
    key,
    direction: current.key === key && current.direction === "descending" ? "ascending" : "descending",
  };
}

export interface SortableHeaderProps {
  label: string;
  active: boolean;
  direction: SortDirection;
  onSort(): void;
}

export function SortableHeader({ label, active, direction, onSort }: SortableHeaderProps) {
  return (
    <th class="sortable-column" aria-sort={active ? direction : undefined}>
      <button class="sort-button" type="button" onClick={onSort}>
        <span>{label}</span>
        <span class={active ? "sort-indicator active" : "sort-indicator"} aria-hidden="true">
          {active ? (direction === "descending" ? "▼" : "▲") : "↕"}
        </span>
      </button>
    </th>
  );
}

export function safeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}
