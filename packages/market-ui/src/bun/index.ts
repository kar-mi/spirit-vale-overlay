import Electrobun, { BrowserView, BrowserWindow } from "electrobun/bun";
import { mountRoundedWindow, publishSafely } from "@spiritvale/ui-core/window-publish";
import { registerUiScaleWindow, scaledSize } from "@spiritvale/ui-core/ui-scale";
import type { WindowPlacementStore } from "@spiritvale/ui-core/window-placement";

import {
  FISHNET_MARKET_STAT_NAMES,
  MarketSessionLogFollower,
  queryFishNetMarketListings,
} from "@kar-mi/spirit-vale-tools-market";
import type { FishNetMarketListingView, FishNetMarketStatFilter } from "@kar-mi/spirit-vale-tools-market";
import type {
  MarketFiltersRpc,
  MarketFiltersState,
  MarketUiFilter,
  MarketUiListing,
  MarketUiRpc,
  MarketUiSortDirection,
  MarketUiSortKey,
  MarketUiState,
  MarketUiStatus,
} from "../app-types.ts";
import { validateMarketUiFilters } from "../filter-model.ts";
import { sortMarketListings } from "../market-sort.ts";

const POLL_MS = 1_000;
const PAGE_SIZE = 50;

export interface MarketWindowOptions {
  logDirectory: string;
  placements?: WindowPlacementStore;
  onClosed?: () => void;
}

export function createMarketWindow(options: MarketWindowOptions) {
const follower = new MarketSessionLogFollower(options.logDirectory);

let window: BrowserWindow;
let filterWindow: BrowserWindow | undefined;
let status: MarketUiStatus = "waiting";
let statusDetail = "Waiting for market data from the central capture.";
let listings: FishNetMarketListingView[] = [];
let query = "";
let filters: MarketUiFilter[] = [];
let sortKey: MarketUiSortKey = "price";
let sortDirection: MarketUiSortDirection = "ascending";
let visibleLimit = PAGE_SIZE;
let polling = false;
let shuttingDown = false;

const rpc = BrowserView.defineRPC<MarketUiRpc>({
  maxRequestTime: 30_000,
  handlers: {
    requests: {
      getState: () => appState(),
      setQuery: ({ query: nextQuery }) => {
        query = nextQuery.trim().slice(0, 200);
        visibleLimit = PAGE_SIZE;
        return appState();
      },
      setSort: ({ key, direction }) => {
        sortKey = key;
        sortDirection = direction;
        visibleLimit = PAGE_SIZE;
        return appState();
      },
      setFilters: ({ filters: nextFilters }) => {
        filters = validateMarketUiFilters(nextFilters, FISHNET_MARKET_STAT_NAMES.length);
        visibleLimit = PAGE_SIZE;
        return appState();
      },
      openFilters: () => { openFilters(); },
      loadMore: () => {
        visibleLimit += PAGE_SIZE;
        return appState();
      },
      windowAction: async ({ action }) => {
        if (action === "minimize") {
          window.minimize();
          return;
        }
        stopPolling();
        window.close();
      },
      getWindowFrame: () => window.getFrame(),
      setWindowFrame: ({ x, y, width, height }) => { window.setFrame(x, y, width, height); },
      toggleMaximize: () => {
        if (window.isMaximized()) window.unmaximize();
        else window.maximize();
        return { maximized: window.isMaximized() };
      },
    },
    messages: {},
  },
});

const filterRpc = BrowserView.defineRPC<MarketFiltersRpc>({
  maxRequestTime: 30_000,
  handlers: {
    requests: {
      getState: () => filtersState(),
      setFilters: ({ filters: nextFilters }) => {
        filters = validateMarketUiFilters(nextFilters, FISHNET_MARKET_STAT_NAMES.length);
        visibleLimit = PAGE_SIZE;
        publish();
        return filtersState();
      },
      windowAction: ({ action }) => {
        if (action === "minimize") filterWindow?.minimize();
        else filterWindow?.close();
      },
      getWindowFrame: () => filterWindow?.getFrame()
        ?? options.placements?.frame(
          "market-filters",
          { x: 140, y: 110, width: 640, height: 680 },
          { width: 520, height: 480 },
        )
        ?? { x: 140, y: 110, width: 640, height: 680 },
      setWindowFrame: ({ x, y, width, height }) => { filterWindow?.setFrame(x, y, width, height); },
    },
    messages: {},
  },
});

window = new BrowserWindow({
  title: "Spirit Vale Market",
  url: "views://marketview/index.html",
  frame: options.placements?.frame(
    "market",
    { x: 100, y: 80, width: 945, height: 800 },
    { width: 520, height: 480 },
  ) ?? { x: 100, y: 80, width: 945, height: 800 },
  titleBarStyle: "hidden",
  transparent: false,
  rpc,
});
mountRoundedWindow(window);
registerUiScaleWindow(window, { scaleInitialFrame: !options.placements });
options.placements?.track("market", window);

Electrobun.events.on(`resize-${window.id}`, (event: { data: { width: number; height: number } }) => {
  const width = Math.max(scaledSize(520), event.data.width);
  const height = Math.max(scaledSize(480), event.data.height);
  if (width !== event.data.width || height !== event.data.height) window.setSize(width, height);
});
window.on("close", () => {
  stopPolling();
  filterWindow?.close();
  options.onClosed?.();
});

const pollTimer = setInterval(() => void pollMarket(), POLL_MS);
void pollMarket();
return {
  show: () => window.show(),
  activate: () => window.activate(),
  close: () => { stopPolling(); filterWindow?.close(); window.close(); },
};

function appState(): MarketUiState {
  const marketFilters: FishNetMarketStatFilter[] = filters.map((filter) => ({ ...filter }));
  const matches = queryFishNetMarketListings(listings, {
    text: query,
    stats: marketFilters,
    statMode: "all",
    sort: "price-asc",
  });
  const sorted = sortMarketListings(matches.map(listingView), sortKey, sortDirection);
  return {
    status,
    statusDetail,
    query,
    sortKey,
    sortDirection,
    filters: filters.map((filter) => ({ ...filter })),
    statOptions: FISHNET_MARKET_STAT_NAMES.map((name, type) => ({ type, name })),
    capturedCount: listings.length,
    matchCount: matches.length,
    visibleLimit,
    hasMore: matches.length > visibleLimit,
    listings: sorted.slice(0, visibleLimit),
  };
}

function filtersState(): MarketFiltersState {
  return {
    filters: filters.map((filter) => ({ ...filter })),
    statOptions: FISHNET_MARKET_STAT_NAMES.map((name, type) => ({ type, name })),
  };
}

function openFilters(): void {
  if (filterWindow) {
    filterWindow.show();
    filterWindow.activate();
    return;
  }
  const nextWindow = new BrowserWindow({
    title: "Spirit Vale Market Filters",
    url: "views://marketfiltersview/index.html",
    frame: options.placements?.frame(
      "market-filters",
      { x: 140, y: 110, width: 640, height: 680 },
      { width: 520, height: 480 },
    ) ?? { x: 140, y: 110, width: 640, height: 680 },
    titleBarStyle: "hidden",
    transparent: false,
    rpc: filterRpc,
  });
  filterWindow = nextWindow;
  mountRoundedWindow(nextWindow);
  registerUiScaleWindow(nextWindow, { scaleInitialFrame: !options.placements });
  options.placements?.track("market-filters", nextWindow);
  Electrobun.events.on(`resize-${nextWindow.id}`, (event: { data: { width: number; height: number } }) => {
    const width = Math.max(scaledSize(520), event.data.width);
    const height = Math.max(scaledSize(480), event.data.height);
    if (width !== event.data.width || height !== event.data.height) nextWindow.setSize(width, height);
  });
  nextWindow.on("close", () => { if (filterWindow === nextWindow) filterWindow = undefined; });
}

function listingView(listing: FishNetMarketListingView, index: number): MarketUiListing {
  return {
    key: listing.id ?? `${listing.sellerId ?? "seller"}-${listing.itemId ?? "item"}-${listing.price}-${index}`,
    name: listing.displayName ?? listing.itemId ?? "Unknown item",
    ...(listing.itemId ? { itemId: listing.itemId } : {}),
    ...(listing.sellerName ? { seller: listing.sellerName } : {}),
    ...(listing.shopName ? { shopName: listing.shopName } : {}),
    ...(listing.mapId ? { mapId: listing.mapId } : {}),
    price: listing.price.toString(),
    available: Math.max(0, listing.count - listing.countTraded),
    stats: (listing.stats ?? []).map((stat) => ({
      type: stat.type,
      name: stat.name ?? `Stat ${stat.type}`,
      ...(stat.value === undefined ? {} : { value: stat.value }),
      roll: stat.roll,
      percent: stat.percent,
    })),
  };
}

async function pollMarket(): Promise<void> {
  if (polling || shuttingDown) return;
  polling = true;
  try {
    const batch = await follower.poll();
    if (batch.changed || batch.reset || batch.status !== status) {
      listings = batch.listings;
      status = batch.status;
      statusDetail = detailFor(batch.status, listings.length, batch.invalidLines);
      publish();
    }
  } catch {
    status = "error";
    statusDetail = "The current market session log could not be read.";
    publish();
  } finally {
    polling = false;
  }
}

function detailFor(nextStatus: MarketUiStatus, count: number, invalidLines: number): string {
  const skipped = invalidLines > 0 ? ` · ${invalidLines} malformed ${invalidLines === 1 ? "record" : "records"} skipped` : "";
  switch (nextStatus) {
    case "waiting": return "Waiting for market data from the central capture.";
    case "watching": return `Market session found. Open the in-game market to receive listings.${skipped}`;
    case "ready": return `${count.toLocaleString()} listings captured in the current session${skipped}`;
    case "stopped": return `Market session stopped; showing its last snapshot${skipped}`;
    case "error": return "The market session reported an error.";
  }
}

function publish(): void {
  if (!window) return;
  publishSafely(() => rpc.send.stateChanged(appState()));
}

function stopPolling(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(pollTimer);
}
}
