import { Fragment, render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { Electroview } from "electrobun/view";
import { DesktopTitleBar } from "@svoverlay/ui-kit/desktop-title-bar";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { SettingsButton } from "@svoverlay/ui-kit/settings-button";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";
import { SortableHeader as CatalogSortHeader, nextSort, safeDomId } from "@svoverlay/ui-kit/sortable-header";
import { useExpandedRows } from "@svoverlay/ui-kit/use-expanded-rows";
import { formatPercentageValue } from "@svoverlay/ui-kit/format";

import type { RewardsCatalogRpc, RewardsCatalogState } from "../app-types.ts";
import { sortRewardCatalog } from "../table-sort.ts";
import type { CatalogSortKey, TableSort } from "../table-sort.ts";

const format = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

const state = signal<RewardsCatalogState | undefined>(undefined);

const rpc = Electroview.defineRPC<RewardsCatalogRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = repairRendererPayload(next); } } },
});
const electroview = new Electroview({ rpc });

void electroview.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });

const CATALOG_DEFAULT_WIDTH = 520;
const CATALOG_DEFAULT_HEIGHT = 420;
void ensureInitialWindowSize(electroview.rpc?.request, { width: CATALOG_DEFAULT_WIDTH, height: CATALOG_DEFAULT_HEIGHT });

function formatChance(value: number): string {
  return formatPercentageValue(value);
}

function App() {
  const next = state.value;
  const queryRef = useRef<HTMLInputElement>(null);
  const [sort, setSort] = useState<TableSort<CatalogSortKey>>({ key: "level", direction: "ascending" });
  const [expanded, toggleExpanded] = useExpandedRows();

  // Only sync the field from server state when the user isn't actively typing
  // in it — mirrors the original imperative guard against clobbering keystrokes.
  useEffect(() => {
    const input = queryRef.current;
    if (input && next && document.activeElement !== input) input.value = next.query;
  }, [next?.query]);

  useEffect(() => {
    if (next) queryRef.current?.focus();
  }, [next !== undefined]);

  if (!next) return null;
  const catalog = sortRewardCatalog(next.catalog, sort);
  return (
    <>
      <DesktopTitleBar
        appTag="Mob Catalog"
        minWidth={520}
        minHeight={420}
        defaultWidth={CATALOG_DEFAULT_WIDTH}
        defaultHeight={CATALOG_DEFAULT_HEIGHT}
        requests={electroview.rpc?.request}
        maximizable
        extraControls={<SettingsButton onClick={() => void electroview.rpc?.request.openSettings({})} />}
      />
      <main>
        <div class="catalog-head">
          <div>
            <h1>Mob catalog</h1>
            <p>Build-matched base values before party and status modifiers.</p>
          </div>
          <span class="pill">{next.catalogCount} mobs</span>
        </div>
        <label class="field catalog-search">
          <span aria-hidden="true">⌕</span>
          <input
            ref={queryRef}
            type="search"
            placeholder="Search mob name or ID…"
            autocomplete="off"
            defaultValue={next.query}
            onInput={(event) => void electroview.rpc?.request.setQuery({ query: (event.target as HTMLInputElement).value })}
          />
        </label>
        <div class="catalog-list">
          {next.catalog.length === 0 ? (
            <div class="empty-state">
              {next.catalogCount === 0 ? "No catalog data is bundled for this build yet." : "No mobs match this search."}
            </div>
          ) : (
            <div class="table-scroll catalog-table-scroll">
              <table class="data-table catalog-table" aria-label="Mob reward catalog">
                <thead><tr>
                  <CatalogSortHeader label="Mob" active={sort.key === "displayName"} direction={sort.direction} onSort={() => setSort(nextSort(sort, "displayName"))} />
                  <CatalogSortHeader label="ID" active={sort.key === "id"} direction={sort.direction} onSort={() => setSort(nextSort(sort, "id"))} />
                  <CatalogSortHeader label="Level" active={sort.key === "level"} direction={sort.direction} onSort={() => setSort(nextSort(sort, "level"))} />
                  <CatalogSortHeader label="Boss" active={sort.key === "boss"} direction={sort.direction} onSort={() => setSort(nextSort(sort, "boss"))} />
                  <CatalogSortHeader label="Base XP" active={sort.key === "baseExperience"} direction={sort.direction} onSort={() => setSort(nextSort(sort, "baseExperience"))} />
                  <CatalogSortHeader label="Base coins" active={sort.key === "baseCoins"} direction={sort.direction} onSort={() => setSort(nextSort(sort, "baseCoins"))} />
                  <th>Drops</th>
                </tr></thead>
                <tbody>{catalog.map((mob) => {
                  const rowKey = `catalog-${mob.id}`;
                  const detailId = `catalog-drops-${safeDomId(mob.id)}`;
                  const isExpanded = expanded.has(rowKey);
                  return <Fragment key={mob.id}>
                    <tr>
                      <th scope="row" title={mob.displayName}>{mob.displayName}</th>
                      <td title={mob.id}>{mob.id}</td>
                      <td>{format.format(mob.level)}</td>
                      <td>{mob.boss ? "Yes" : "No"}</td>
                      <td>{format.format(mob.baseExperience)}</td>
                      <td>{format.format(mob.baseCoins)}</td>
                      <td>{mob.drops.length === 0 ? "—" : <button class="table-detail-button" type="button" aria-expanded={isExpanded} aria-controls={detailId} onClick={() => toggleExpanded(rowKey)}>{isExpanded ? "▾" : "▸"} {mob.drops.length}</button>}</td>
                    </tr>
                    {isExpanded && mob.drops.length > 0 && <tr id={detailId} class="table-detail-row"><td colSpan={7}><div class="table-detail-chips">{mob.drops.map((drop, index) => <span class="chip" key={`${drop.itemId}-${index}`}>{`${drop.itemName} ×${drop.count}${drop.chance === undefined ? "" : ` · ${formatChance(drop.chance)}`}`}</span>)}</div></td></tr>}
                  </Fragment>;
                })}</tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

render(<App />, document.getElementById("root")!);
