import { useState } from "preact/hooks";

export interface EnemyFilterOption {
  targetId: number;
  label: string;
}

export interface EnemyFilterControlProps {
  enemies: readonly EnemyFilterOption[];
  selected: ReadonlySet<number>;
  onChange(selected: Set<number>): void;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");
}

/** Searchable multi-select of enemies, used to scope combat summaries to specific targets. */
export function EnemyFilterControl({ enemies, selected, onChange }: EnemyFilterControlProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  if (enemies.length === 0) return null;

  const needle = normalize(query);
  const visible = needle ? enemies.filter((enemy) => normalize(enemy.label).includes(needle)) : enemies;

  function toggle(targetId: number): void {
    const next = new Set(selected);
    if (next.has(targetId)) next.delete(targetId);
    else next.add(targetId);
    onChange(next);
  }

  const summary = selected.size === 0
    ? "All enemies"
    : selected.size === 1
      ? enemies.find((enemy) => selected.has(enemy.targetId))?.label ?? "1 enemy"
      : `${selected.size} enemies`;

  return (
    <div class="enemy-filter">
      <button
        type="button"
        class="btn enemy-filter-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {summary}
      </button>
      {open && <div class="enemy-filter-panel">
        <label class="field enemy-filter-search" for="enemy-filter-query">
          <span aria-hidden="true">⌕</span>
          <input
            id="enemy-filter-query"
            type="search"
            autocomplete="off"
            placeholder="Search enemies"
            value={query}
            onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
          />
        </label>
        <div class="enemy-filter-list">
          {visible.map((enemy) => (
            <label class="enemy-filter-row" key={enemy.targetId}>
              <input
                type="checkbox"
                checked={selected.has(enemy.targetId)}
                onChange={() => toggle(enemy.targetId)}
              />
              <span>{enemy.label}</span>
            </label>
          ))}
          {visible.length === 0 && <p class="enemy-filter-empty">No enemies match "{query}".</p>}
        </div>
        {selected.size > 0 && (
          <button type="button" class="btn btn-ghost enemy-filter-clear" onClick={() => onChange(new Set())}>
            Clear filter
          </button>
        )}
      </div>}
    </div>
  );
}
