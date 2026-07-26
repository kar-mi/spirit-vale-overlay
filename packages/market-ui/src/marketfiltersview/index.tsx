import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Electroview } from "electrobun/view";
import { TitleBar } from "@spiritvale/ui-core/title-bar";

import type { MarketFiltersRpc, MarketFiltersState, MarketUiFilter } from "../app-types.ts";

interface DraftFilter { enabled: boolean; min: string; max: string }

const rpc = Electroview.defineRPC<MarketFiltersRpc>({ handlers: { requests: {}, messages: {} } });
const electroview = new Electroview({ rpc });

function close(): void {
  void electroview.rpc?.request.windowAction({ action: "close" });
}

function humanizeStat(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/\bHp\b/g, "HP")
    .replace(/\bMp\b/g, "MP");
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");
}

function numericBound(value: string): number | undefined | null {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function App() {
  const [state, setState] = useState<MarketFiltersState | undefined>(undefined);
  const [draftFilters, setDraftFilters] = useState<Map<number, DraftFilter>>(new Map());
  const [statQuery, setStatQuery] = useState("");
  const [filterError, setFilterError] = useState("");
  const queryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void electroview.rpc?.request.getState({}).then((next) => {
      setState(next);
      setDraftFilters(new Map(next.filters.map((filter) => [filter.stat, {
        enabled: true,
        min: filter.minValue === undefined ? "" : String(filter.minValue),
        max: filter.maxValue === undefined ? "" : String(filter.maxValue),
      }])));
      queryInputRef.current?.focus();
    });
  }, []);

  function updateDraft(stat: number, patch: Partial<DraftFilter>): void {
    setDraftFilters((current) => {
      const next = new Map(current);
      const existing = next.get(stat) ?? { enabled: false, min: "", max: "" };
      next.set(stat, { ...existing, ...patch });
      return next;
    });
  }

  function applyFilters(event: Event): void {
    event.preventDefault();
    const result: MarketUiFilter[] = [];
    for (const [stat, draft] of draftFilters) {
      if (!draft.enabled) continue;
      const minValue = numericBound(draft.min);
      const maxValue = numericBound(draft.max);
      if (minValue === null || maxValue === null) {
        setFilterError("Minimum and maximum values must be finite numbers.");
        return;
      }
      if (minValue !== undefined && maxValue !== undefined && minValue > maxValue) {
        const name = humanizeStat(state?.statOptions.find((option) => option.type === stat)?.name ?? `Stat ${stat}`);
        setFilterError(`${name} has a minimum greater than its maximum.`);
        return;
      }
      result.push({ stat, ...(minValue === undefined ? {} : { minValue }), ...(maxValue === undefined ? {} : { maxValue }) });
    }
    setFilterError("");
    void electroview.rpc?.request.setFilters({ filters: result.sort((left, right) => left.stat - right.stat) }).then(close);
  }

  const needle = normalize(statQuery);
  const visibleOptions = state?.statOptions.filter((option) => normalize(option.name).includes(needle)) ?? [];

  return (
    <main class="app-shell">
      <TitleBar
        appTag="Market Filters"
        minWidth={520}
        minHeight={480}
        getFrame={async () => (await electroview.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: 640, height: 680 }}
        setFrame={(frame) => void electroview.rpc?.request.setWindowFrame(frame)}
        onMinimize={() => void electroview.rpc?.request.windowAction({ action: "minimize" })}
        onClose={close}
      />
      <form class="filter-form" onSubmit={applyFilters}>
        <header class="filter-head">
          <div>
            <h1>Stat filters</h1>
            <p>Checked stats must all match. Blank ranges require the stat at any value.</p>
          </div>
        </header>
        <label class="field stat-search" for="stat-query">
          <span aria-hidden="true">⌕</span>
          <input
            id="stat-query"
            ref={queryInputRef}
            type="search"
            autocomplete="off"
            placeholder="Search stats"
            value={statQuery}
            onInput={(event) => setStatQuery((event.target as HTMLInputElement).value)}
          />
        </label>
        <div class="stat-head t-label" aria-hidden="true"><span>Use / stat</span><span>Minimum</span><span>Maximum</span></div>
        <div class="stat-list">
          {visibleOptions.map((option) => {
            const draft = draftFilters.get(option.type) ?? { enabled: false, min: "", max: "" };
            return (
              <div class="stat-row" key={option.type}>
                <label class="stat-toggle">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(event) => updateDraft(option.type, { enabled: (event.target as HTMLInputElement).checked })}
                  />
                  <span>{humanizeStat(option.name)}</span>
                </label>
                <input
                  class="input range-input"
                  type="number"
                  step="any"
                  placeholder="Minimum"
                  aria-label="Minimum"
                  value={draft.min}
                  disabled={!draft.enabled}
                  onInput={(event) => updateDraft(option.type, { min: (event.target as HTMLInputElement).value })}
                />
                <input
                  class="input range-input"
                  type="number"
                  step="any"
                  placeholder="Maximum"
                  aria-label="Maximum"
                  value={draft.max}
                  disabled={!draft.enabled}
                  onInput={(event) => updateDraft(option.type, { max: (event.target as HTMLInputElement).value })}
                />
              </div>
            );
          })}
        </div>
        <p class="filter-error" role="alert">{filterError}</p>
        <footer class="filter-actions">
          <button
            id="clear-filters-button"
            class="btn btn-ghost"
            type="button"
            onClick={() => { setDraftFilters(new Map()); setFilterError(""); }}
          >
            Clear all
          </button>
          <button class="btn" type="button" onClick={close}>Cancel</button>
          <button class="btn btn-primary" type="submit">Apply filters</button>
        </footer>
      </form>
    </main>
  );
}

render(<App />, document.getElementById("root")!);
