import type { RPCSchema } from "electrobun";
import type { MarketLogStatus } from "@kar-mi/spirit-vale-tools-market";
import type { MaximizableWindowChromeRequests, WindowChromeRequests } from "@spiritvale/ui-core/window-rpc";

export type MarketUiStatus = MarketLogStatus;
export type MarketUiSortKey = "name" | "price" | "available" | "seller" | "shopName" | "mapId";
export type MarketUiSortDirection = "ascending" | "descending";

export interface MarketUiFilter {
  stat: number;
  minValue?: number;
  maxValue?: number;
}

export interface MarketUiStat {
  type: number;
  name: string;
  value?: number;
  roll: number;
  percent: boolean;
}

export interface MarketUiListing {
  key: string;
  name: string;
  itemId?: string;
  seller?: string;
  shopName?: string;
  mapId?: string;
  price: string;
  available: number;
  stats: MarketUiStat[];
}

export interface MarketUiState {
  status: MarketUiStatus;
  statusDetail: string;
  query: string;
  sortKey: MarketUiSortKey;
  sortDirection: MarketUiSortDirection;
  filters: MarketUiFilter[];
  statOptions: Array<{ type: number; name: string }>;
  capturedCount: number;
  matchCount: number;
  visibleLimit: number;
  hasMore: boolean;
  listings: MarketUiListing[];
}

export interface MarketFiltersState {
  filters: MarketUiFilter[];
  statOptions: Array<{ type: number; name: string }>;
}

export type MarketUiRpc = {
  bun: RPCSchema<{
    requests: MaximizableWindowChromeRequests & {
      getState: { params: Record<string, never>; response: MarketUiState };
      setQuery: { params: { query: string }; response: MarketUiState };
      setSort: { params: { key: MarketUiSortKey; direction: MarketUiSortDirection }; response: MarketUiState };
      setFilters: { params: { filters: MarketUiFilter[] }; response: MarketUiState };
      openFilters: { params: Record<string, never>; response: void };
      loadMore: { params: Record<string, never>; response: MarketUiState };
    };
  }>;
  webview: RPCSchema<{
    messages: {
      stateChanged: MarketUiState;
    };
  }>;
};

export type MarketFiltersRpc = {
  bun: RPCSchema<{
    requests: WindowChromeRequests & {
      getState: { params: Record<string, never>; response: MarketFiltersState };
      setFilters: { params: { filters: MarketUiFilter[] }; response: MarketFiltersState };
    };
  }>;
  webview: RPCSchema<{ messages: Record<string, never> }>;
};
