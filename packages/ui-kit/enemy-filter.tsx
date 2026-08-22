import { CheckboxMultiSelect } from "./checkbox-multi-select.tsx";

export interface EnemyFilterOption {
  targetId: number;
  label: string;
}

export interface EnemyFilterControlProps {
  enemies: readonly EnemyFilterOption[];
  selected: ReadonlySet<number>;
  onChange(selected: Set<number>): void;
}

export function EnemyFilterControl({ enemies, selected, onChange }: EnemyFilterControlProps) {
  return (
    <CheckboxMultiSelect
      options={enemies.map((enemy) => ({ value: enemy.targetId, label: enemy.label }))}
      selected={selected}
      onChange={onChange}
      ariaLabel="Filter by enemy"
      searchPlaceholder="Search enemies"
      clearLabel="Clear filter"
      noMatchLabel={(query) => `No enemies match "${query}".`}
      summarize={(chosen, options) => chosen.size === 0
        ? "All enemies"
        : chosen.size === 1
          ? options.find((option) => chosen.has(option.value))?.label ?? "1 enemy"
          : `${chosen.size} enemies`}
    />
  );
}
