import { Fragment, render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { DesktopView } from "@svoverlay/desktop-runtime/view";
import { TitleBar } from "@svoverlay/ui-kit/title-bar";
import { ensureInitialWindowSize } from "@svoverlay/ui-kit/ensure-window-size";
import { SettingsButton } from "@svoverlay/ui-kit/settings-button";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";
import { nextTableSort, SortableHeader } from "@svoverlay/ui-kit/sortable-table";
import type { TableSort } from "@svoverlay/ui-kit/sortable-table";
import { useTranslator } from "@svoverlay/i18n/browser";

import type { RewardsCatalogRpc, RewardsCatalogState } from "../app-types.ts";
import { sortRewardCatalog } from "../table-sort.ts";
import type { CatalogSortKey } from "../table-sort.ts";

const format = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

const state = signal<RewardsCatalogState | undefined>(undefined);

const rpc = DesktopView.defineRPC<RewardsCatalogRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = repairRendererPayload(next); } } },
});
const desktopView = new DesktopView({ rpc });

void desktopView.rpc?.request.getState({}).then((next) => { state.value = repairRendererPayload(next); });

const CATALOG_DEFAULT_WIDTH = 520;
const CATALOG_DEFAULT_HEIGHT = 420;
void ensureInitialWindowSize(desktopView.rpc?.request, { width: CATALOG_DEFAULT_WIDTH, height: CATALOG_DEFAULT_HEIGHT });

function formatChance(value: number): string {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value)}%`;
}

function App() {
  const t = useTranslator();
  const next = state.value;
  const queryRef = useRef<HTMLInputElement>(null);
  const [sort, setSort] = useState<TableSort<CatalogSortKey>>({ key: "level", direction: "ascending" });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const input = queryRef.current;
    if (input && next && document.activeElement !== input) input.value = next.query;
  }, [next?.query]);

  useEffect(() => {
    if (next) queryRef.current?.focus();
  }, [next !== undefined]);

  if (!next) return null;
  const catalog = sortRewardCatalog(next.catalog, sort);
  const toggleExpanded = (key: string): void => {
    setExpanded((current) => {
      const updated = new Set(current);
      if (updated.has(key)) updated.delete(key); else updated.add(key);
      return updated;
    });
  };
  const sortBy = (key: CatalogSortKey): void => {
    setSort((current) => nextTableSort(current, key));
  };

  return (
    <>
      <TitleBar
        appTag={t("catalog.window.tag")}
        minWidth={520}
        minHeight={420}
        getFrame={async () => (await desktopView.rpc?.request.getWindowFrame({})) ?? { x: 0, y: 0, width: CATALOG_DEFAULT_WIDTH, height: CATALOG_DEFAULT_HEIGHT }}
        setFrame={(frame) => void desktopView.rpc?.request.setWindowFrame(frame)}
        toggleMaximize={async () => (await desktopView.rpc?.request.toggleMaximize({}))?.maximized ?? false}
        onMinimize={() => void desktopView.rpc?.request.windowAction({ action: "minimize" })}
        onClose={() => void desktopView.rpc?.request.windowAction({ action: "close" })}
        extraControls={<SettingsButton onClick={() => void desktopView.rpc?.request.openSettings({})} />}
      />
      <main>
        <div class="catalog-head">
          <div>
            <h1>{t("catalog.heading")}</h1>
            <p>{t("catalog.hint")}</p>
          </div>
          <span class="pill">{t("catalog.count", { count: next.catalogCount })}</span>
        </div>
        <label class="field catalog-search">
          <span aria-hidden="true">⌕</span>
          <input
            ref={queryRef}
            type="search"
            placeholder={t("catalog.searchPlaceholder")}
            autocomplete="off"
            defaultValue={next.query}
            onInput={(event) => void desktopView.rpc?.request.setQuery({ query: (event.target as HTMLInputElement).value })}
          />
        </label>
        <div class="catalog-list">
          {next.catalog.length === 0 ? (
            <div class="empty-state">
              {t(next.catalogCount === 0 ? "catalog.emptyBundle" : "catalog.noMatch")}
            </div>
          ) : (
            <div class="table-scroll catalog-table-scroll">
              <table class="data-table catalog-table" aria-label={t("catalog.label")}>
                <thead><tr>
                  <SortableHeader sortKey="displayName" sort={sort} onSort={sortBy} align="start">{t("catalog.column.mob")}</SortableHeader>
                  <SortableHeader sortKey="id" sort={sort} onSort={sortBy}>{t("catalog.column.id")}</SortableHeader>
                  <SortableHeader sortKey="level" sort={sort} onSort={sortBy}>{t("catalog.column.level")}</SortableHeader>
                  <SortableHeader sortKey="boss" sort={sort} onSort={sortBy}>{t("catalog.column.boss")}</SortableHeader>
                  <SortableHeader sortKey="baseExperience" sort={sort} onSort={sortBy}>{t("catalog.column.baseXp")}</SortableHeader>
                  <SortableHeader sortKey="baseCoins" sort={sort} onSort={sortBy}>{t("catalog.column.baseCoins")}</SortableHeader>
                  <th>{t("catalog.column.drops")}</th>
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
                      <td>{t(mob.boss ? "catalog.boss.yes" : "catalog.boss.no")}</td>
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

function safeDomId(value: string): string { return value.replace(/[^a-zA-Z0-9_-]/g, "-"); }

render(<App />, document.getElementById("root")!);
