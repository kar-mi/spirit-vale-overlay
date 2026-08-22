import { useId, useRef, useState } from "preact/hooks";
import { normalizeSearchText } from "./format";
import { useDismissable } from "./use-dismissable.ts";

export interface CheckboxMultiSelectOption<T extends string | number> {
  value: T;
  label: string;
  iconSrc?: string;
}

export interface CheckboxMultiSelectProps<T extends string | number> {
  options: readonly CheckboxMultiSelectOption<T>[];
  selected: ReadonlySet<T>;
  onChange(selected: Set<T>): void;
  summarize(selected: ReadonlySet<T>, options: readonly CheckboxMultiSelectOption<T>[]): string;
  searchPlaceholder: string;
  clearLabel: string;
  noMatchLabel(query: string): string;
  ariaLabel: string;
}

export function CheckboxMultiSelect<T extends string | number>(
  { options, selected, onChange, summarize, searchPlaceholder, clearLabel, noMatchLabel, ariaLabel }:
    CheckboxMultiSelectProps<T>,
) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Several of these can share a page, so the search field needs an id unique to this instance.
  const queryId = useId();

  useDismissable(rootRef, open, () => setOpen(false));

  if (options.length === 0) return null;

  const needle = normalizeSearchText(query);
  const visible = needle ? options.filter((option) => normalizeSearchText(option.label).includes(needle)) : options;

  function toggle(value: T): void {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  return (
    <div class="multi-select" ref={rootRef}>
      <button
        type="button"
        class="input custom-select-toggle multi-select-toggle"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span class="custom-select-value">{summarize(selected, options)}</span>
      </button>
      {open && <div class="multi-select-panel">
        <label class="field multi-select-search" for={queryId}>
          <span aria-hidden="true">⌕</span>
          <input
            id={queryId}
            type="search"
            autocomplete="off"
            placeholder={searchPlaceholder}
            value={query}
            onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
          />
        </label>
        <div class="multi-select-list">
          {visible.map((option) => (
            <label class="multi-select-row" key={option.value}>
              <input
                type="checkbox"
                checked={selected.has(option.value)}
                onChange={() => toggle(option.value)}
              />
              {option.iconSrc && <img class="multi-select-icon" src={option.iconSrc} alt="" aria-hidden="true" />}
              <span>{option.label}</span>
            </label>
          ))}
          {visible.length === 0 && <p class="multi-select-empty">{noMatchLabel(query)}</p>}
        </div>
        {selected.size > 0 && (
          <button type="button" class="btn btn-ghost multi-select-clear" onClick={() => onChange(new Set())}>
            {clearLabel}
          </button>
        )}
      </div>}
    </div>
  );
}
