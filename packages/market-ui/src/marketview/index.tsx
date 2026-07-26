import { Fragment, render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { signal } from "@preact/signals";
import { Electroview } from "electrobun/view";
import { TitleBar } from "@spiritvale/ui-core/title-bar";
import { StatusDot } from "@spiritvale/ui-core/status-dot";

import type { MarketUiRpc, MarketUiSortDirection, MarketUiSortKey, MarketUiState, MarketUiStat } from "../app-types.ts";

const STATUS_TONE: Record<MarketUiState["status"], "is-ok" | "is-warn" | "is-err"> = {
  waiting: "is-warn",
  watching: "is-ok",
  ready: "is-ok",
  stopped: "is-warn",
  error: "is-err",
};

const numberFormat = new Intl.NumberFormat();
let queryTimer: ReturnType<typeof setTimeout> | undefined;

const state = signal<MarketUiState | undefined>(undefined);

const rpc = Electroview.defineRPC<MarketUiRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = next; } } },
});
const electroview = new Electroview({ rpc });

void electroview.rpc?.request.getState({}).then((next) => { state.value = next; });

function setQuery(query: string): void {
  if (queryTimer) clearTimeout(queryTimer);
  queryTimer = setTimeout(() => {
    void electroview.rpc?.request.setQuery({ query }).then((next) => { state.value = next; });
  }, 150);
}

function loadMore(): void {
  void electroview.rpc?.request.loadMore({}).then((next) => { state.value = next; });
}

function formatPrice(value: string): string {
  try {
    return numberFormat.format(BigInt(value));
  } catch {
    return value;
  }
}

function formatStat(stat: MarketUiStat): string {
  const value = stat.value === undefined ? `roll ${numberFormat.format(stat.roll)}` : `${numberFormat.format(stat.value)}${stat.percent ? "%" : ""}`;
  return `${humanizeStat(stat.name)} ${value}`;
}

function humanizeStat(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/\bHp\b/g, "HP")
    .replace(/\bMp\b/g, "MP");
}

function App() {
  const next = state.value;
  const queryRef = useRef<HTMLInputElement>(null);

  // Only sync the field from server state when the user isn't actively typing in
  // it — otherwise the debounced setQuery round-trip would clobber keystrokes
  // typed between the request firing and its response landing.
  useEffect(() => {
    const input = queryRef.current;
    if (input && next && document.activeElement !== input) input.value = next.query;
  }, [next?.query]);

  if (!next) return <main class="app-shell" />;

  const changeSort = (key: MarketUiSortKey): void => {
    const direction: MarketUiSortDirection = next.sortKey === key && next.sortDirection === "ascending" ? "descending" : "ascending";
    void electroview.rpc?.request.setSort({ key, direction }).then((updated) => { state.value = updated; });
  };

  return (
    <main class="app-shell">
      <TitleBar
        appTag="Market"
        minWidth={520}
        minHeight={480}
        getFrame={async () => (await electroview.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: 520, height: 480 }}
        setFrame={(frame) => void electroview.rpc?.request.setWindowFrame(frame)}
        toggleMaximize={async () => (await electroview.rpc?.request.toggleMaximize({}))?.maximized ?? false}
        onMinimize={() => void electroview.rpc?.request.windowAction({ action: "minimize" })}
        onClose={() => void electroview.rpc?.request.windowAction({ action: "close" })}
      />
      <section class="search-bar">
        <label class="field" for="market-query">
          <span aria-hidden="true">⌕</span>
          <input
            id="market-query"
            ref={queryRef}
            type="search"
            maxLength={200}
            autocomplete="off"
            placeholder="Search items, sellers, shops, or maps"
            defaultValue={next.query}
            onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
          />
        </label>
        <button class={next.filters.length > 0 ? "btn active" : "btn"} type="button" onClick={() => void electroview.rpc?.request.openFilters({})}>
          Filters {next.filters.length > 0 && <span class="filter-count">{next.filters.length}</span>}
        </button>
      </section>
      <section class="status-strip" aria-live="polite">
        <StatusDot tone={STATUS_TONE[next.status]} detail={next.statusDetail} />
        <strong id="result-count" class="t-data">{numberFormat.format(next.matchCount)} {next.matchCount === 1 ? "result" : "results"}</strong>
      </section>
      <section class="results" aria-label="Market listings">
        {next.listings.length === 0 ? (
          <div class="empty-state">
            {next.status === "waiting"
              ? "No active market session. Start the passive market command, then open the in-game market."
              : next.capturedCount === 0
                ? "Waiting for market listings from the current session."
                : "No captured listings match this search and filter set."}
          </div>
        ) : (
          <div class="table-scroll results-table-scroll">
            <table class="data-table market-table">
              <thead><tr>
                <SortableHeader label="Item" sortKey="name" state={next} onSort={changeSort} />
                <SortableHeader label="Price" sortKey="price" state={next} onSort={changeSort} />
                <SortableHeader label="Qty" sortKey="available" state={next} onSort={changeSort} />
                <SortableHeader label="Seller" sortKey="seller" state={next} onSort={changeSort} />
                <SortableHeader label="Shop" sortKey="shopName" state={next} onSort={changeSort} />
                <SortableHeader label="Map" sortKey="mapId" state={next} onSort={changeSort} />
                <th>Stats</th>
              </tr></thead>
              <tbody>{next.listings.map((listing) => {
                return <Fragment key={listing.key}>
                  <tr>
                    <th scope="row" title={listing.name}>
                      <span class="primary-cell">{listing.name}</span>
                      {listing.itemId && <span class="secondary-cell">{listing.itemId}</span>}
                    </th>
                    <td class="is-value" title={formatPrice(listing.price)}>{formatPrice(listing.price)}</td>
                    <td>{numberFormat.format(listing.available)}</td>
                    <td title={listing.seller}>{listing.seller ?? "—"}</td>
                    <td title={listing.shopName}>{listing.shopName ?? "—"}</td>
                    <td title={listing.mapId}>{listing.mapId ?? "—"}</td>
                    <td>{listing.stats.length === 0 ? "—" : listing.stats.length}</td>
                  </tr>
                  {listing.stats.length > 0 && <tr class="table-detail-row"><td colSpan={7}><div class="table-detail-chips">{listing.stats.map((stat, index) => <span class="chip" key={`${stat.type}-${index}`}>{formatStat(stat)}</span>)}</div></td></tr>}
                </Fragment>;
              })}</tbody>
            </table>
          </div>
        )}
      </section>
      <div class="load-more-row">
        {next.hasMore && <button class="btn" type="button" onClick={loadMore}>Load more</button>}
      </div>
    </main>
  );
}

function SortableHeader({ label, sortKey, state: next, onSort }: { label: string; sortKey: MarketUiSortKey; state: MarketUiState; onSort(key: MarketUiSortKey): void }) {
  const active = next.sortKey === sortKey;
  return (
    <th class="sortable-column" aria-sort={active ? next.sortDirection : undefined}>
      <button class="sort-button" type="button" onClick={() => onSort(sortKey)}>
        <span>{label}</span><span class={active ? "sort-indicator active" : "sort-indicator"} aria-hidden="true">{active ? (next.sortDirection === "descending" ? "▼" : "▲") : "↕"}</span>
      </button>
    </th>
  );
}

render(<App />, document.getElementById("root")!);
