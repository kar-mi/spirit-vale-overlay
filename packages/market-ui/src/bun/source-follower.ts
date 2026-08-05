import { JsonlTailReader, LiveLogSessionFollower, parseLogRecord } from "@kar-mi/spirit-vale-tools-logging";
import type { JsonObject, LiveLogStatus } from "@kar-mi/spirit-vale-tools-logging";
import {
  FishNetMarketTracker,
  marketListingKey,
  parseFishNetMarketStats,
  parseMarketEventLogData,
} from "@kar-mi/spirit-vale-tools-market";
import type { FishNetMarketEvent, FishNetMarketListingView } from "@kar-mi/spirit-vale-tools-market";

export type MarketSourceStatus = LiveLogStatus;

export interface MarketSourceBatch {
  /** Listings from the global market catalog (`RequestVendorItemList_T`). */
  market: FishNetMarketListingView[];
  /** Listings read out of individual player vending stalls (`RequestVendingStallListings_T`). */
  stall: FishNetMarketListingView[];
  invalidLines: number;
  missing: boolean;
  reset: boolean;
  changed: boolean;
  status: MarketSourceStatus;
  observedAt?: string;
  path?: string;
  sessionId?: string;
}

/**
 * Splits a market session log into catalog listings and stall listings.
 *
 * Upstream's `MarketLogFollower` runs a single `FishNetMarketTracker`, which keys both sources into
 * one map and — critically — clears that map on every `catalog` event. Browsing the in-game market
 * therefore discards every stall listing collected beforehand, and what survives is indistinguishable
 * by source.
 *
 * Running two trackers over a partition of the same event stream fixes both problems without
 * touching the tools package: the stall tracker never sees a `catalog` event, so its listings
 * accumulate, and each tracker's `query()` still supplies upstream display names, parsed stats, and
 * the seller-to-stall join. Stall events feed *both* trackers because that join reads each tracker's
 * own stall map.
 */
export class MarketSourceLogFollower {
  private readonly reader: JsonlTailReader;
  private readonly marketTracker = new FishNetMarketTracker();
  private readonly stallTracker = new FishNetMarketTracker();
  private readonly serverNames = new Map<string, string>();
  private market: FishNetMarketListingView[] = [];
  private stall: FishNetMarketListingView[] = [];
  private status: MarketSourceStatus = "watching";
  private observedAt?: string;

  constructor(path: string) {
    this.reader = new JsonlTailReader(path);
  }

  async poll(): Promise<MarketSourceBatch> {
    const { missing, reset, lines } = await this.reader.read();
    if (missing) return this.batch({ missing: true, reset: false, changed: false, invalidLines: 0 });
    if (reset) this.resetState();
    const consumed = this.consume(lines);
    return this.batch({ missing: false, reset, ...consumed });
  }

  private consume(lines: string[]): Pick<MarketSourceBatch, "changed" | "invalidLines"> {
    let invalidLines = 0;
    let changed = false;
    for (const line of lines) {
      if (!line.trim()) continue;
      let candidate: unknown;
      try {
        candidate = JSON.parse(line);
      } catch {
        invalidLines += 1;
        continue;
      }
      const record = parseLogRecord(candidate);
      if (!record) {
        invalidLines += 1;
        continue;
      }
      if (record.type === "market.lifecycle") {
        const lifecycle = record.data["state"];
        if (lifecycle === "started") this.status = this.captured() > 0 ? "ready" : "watching";
        else if (lifecycle === "stopped") this.status = "stopped";
        else {
          invalidLines += 1;
          continue;
        }
        changed = true;
        continue;
      }
      if (record.type === "market.error") {
        this.status = "error";
        changed = true;
        continue;
      }
      if (record.type !== "market.event") continue;
      const event = parseMarketEventLogData(record.data);
      if (!event) {
        invalidLines += 1;
        continue;
      }
      this.harvestServerNames(record.data);
      this.dispatch(event);
      this.status = "ready";
      this.observedAt = record.recordedAt;
      changed = true;
    }
    return { invalidLines, changed };
  }

  /** Routes one event to the tracker(s) that own it, then refreshes only the affected views. */
  private dispatch(event: FishNetMarketEvent): void {
    switch (event.kind) {
      case "catalog":
      case "account":
      case "collectResult":
        this.marketTracker.apply(event);
        this.market = this.repaired(this.marketTracker.query());
        return;
      case "listings":
        this.stallTracker.apply(event);
        this.stall = this.repaired(this.stallTracker.query());
        return;
      case "stalls":
      case "stallUpsert":
      case "stallRemove":
        // Shop name and map only resolve through each tracker's own stall map, so both need these.
        this.marketTracker.apply(event);
        this.stallTracker.apply(event);
        this.market = this.repaired(this.marketTracker.query());
        this.stall = this.repaired(this.stallTracker.query());
    }
  }

  /**
   * Recovers the item names the game itself sent, which the tracker would otherwise discard.
   *
   * `ItemDisplayName` reaches us as a listing's `searchText`, but `FishNetMarketTracker.apply()`
   * forwards it only for `catalog` events — `listings` and `account.ownListings` both upsert with a
   * null name (`market.ts:347,361`), and the event-log listing parser drops the field outright. The
   * bundled item directory cannot cover for that: market listings arrive as item type 3 while the
   * catalog files those same ids under type 2, so it resolves nothing here and the display name
   * falls all the way back to the raw id — "Armor_Vit" instead of "Endurance Plate".
   *
   * The raw log record still carries the field, so it is read straight off `record.data` before the
   * typed event throws it away.
   */
  private harvestServerNames(data: JsonObject): void {
    const kind = data["kind"];
    if (kind === "listings") {
      this.harvestListings(data["listings"]);
      return;
    }
    if (kind === "account") {
      const account = data["account"];
      if (isRecord(account)) this.harvestListings(account["ownListings"]);
      return;
    }
    if (kind !== "catalog") return;
    if (!Array.isArray(data["items"])) return;
    for (const item of data["items"]) {
      if (isRecord(item)) this.rememberName(item["listing"], item["searchText"]);
    }
  }

  private harvestListings(value: unknown): void {
    if (!Array.isArray(value)) return;
    for (const listing of value) {
      if (isRecord(listing)) this.rememberName(listing, listing["searchText"]);
    }
  }

  private rememberName(listing: unknown, searchText: unknown): void {
    if (!isRecord(listing) || typeof searchText !== "string") return;
    const name = searchText.trim();
    if (!name) return;
    const key = listingKeyOf(listing);
    if (key !== undefined) this.serverNames.set(key, name);
  }

  /**
   * Restores the two fields the tracker gets wrong for market listings.
   *
   * The name comes from the harvested server value, which wins over the bundled catalog's: the
   * catalog is a per-build datamine that drifts, while this is what the player sees in game now.
   *
   * The substats are recomputed against the corrected item type — see {@link catalogItemType}.
   */
  private repaired(views: FishNetMarketListingView[]): FishNetMarketListingView[] {
    return views.map((view) => {
      const name = this.serverNames.get(marketListingKey(view));
      const stats = parseFishNetMarketStats(view.json, catalogItemType(view.itemType)) ?? view.stats;
      const renamed = name !== undefined && name !== view.displayName;
      if (!renamed && stats === view.stats) return view;
      return {
        ...view,
        ...(renamed ? { displayName: name, searchText: view.searchText ?? name } : {}),
        ...(stats ? { stats } : {}),
      };
    });
  }

  private captured(): number {
    return this.market.length + this.stall.length;
  }

  private resetState(): void {
    this.marketTracker.reset();
    this.stallTracker.reset();
    this.serverNames.clear();
    this.market = [];
    this.stall = [];
    this.status = "watching";
    this.observedAt = undefined;
  }

  private batch(detail: Pick<MarketSourceBatch, "missing" | "reset" | "changed" | "invalidLines">): MarketSourceBatch {
    return {
      ...detail,
      market: this.market.slice(),
      stall: this.stall.slice(),
      status: detail.missing ? "waiting" : this.status,
      ...(this.observedAt ? { observedAt: this.observedAt } : {}),
    };
  }
}

/**
 * Converts a market listing's item type to the one the bundled item catalog uses.
 *
 * The vending wire enum sits exactly one above the catalog's: equipment is 3 on a listing but 2 in
 * the catalog, artifacts 4 against 3, cards 5 against 4, gems 6 against 5. Replaying every market
 * log in `logs/sessions` resolves 153 of 153 distinct items at this offset and 0 of 153 without it.
 *
 * Left uncorrected the damage is twofold: the catalog never resolves, and
 * `calculateFishNetMarketStatValues` reads a listing's equipment (3) as an artifact and scores its
 * substats against `ARTIFACT_CAPS`. Only four stats have an artifact cap, so everything else loses
 * its cap and the view falls back to printing the raw 0-100 roll — "Crit roll 73" for what the game
 * shows as "Crit 9".
 */
function catalogItemType(itemType: number): number {
  return itemType > 0 ? itemType - 1 : itemType;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Keys a raw log listing the way `FishNetMarketTracker` keys its parsed one.
 *
 * `marketListingKey` interpolates the price, and the log stores it as a decimal string rather than a
 * bigint, so it is normalised here to keep both spellings on the same key.
 */
function listingKeyOf(listing: Record<string, unknown>): string | undefined {
  const id = listing["id"];
  if (typeof id === "string") return marketListingKey({ id, sellerId: null, itemId: null, price: 0n });
  const price = listing["price"];
  if (typeof price !== "string" && typeof price !== "number") return undefined;
  let parsed: bigint;
  try {
    parsed = BigInt(price);
  } catch {
    return undefined;
  }
  return marketListingKey({
    id: null,
    sellerId: typeof listing["sellerId"] === "string" ? listing["sellerId"] : null,
    itemId: typeof listing["itemId"] === "string" ? listing["itemId"] : null,
    price: parsed,
  });
}

/** Follows whichever market session is named by the shared current-stream pointer. */
export class MarketSourceSessionLogFollower {
  private readonly inner: LiveLogSessionFollower<MarketSourceLogFollower, MarketSourceBatch>;

  constructor(logDirectory?: string) {
    this.inner = new LiveLogSessionFollower({
      stream: "market",
      logDirectory,
      createFollower: (path) => new MarketSourceLogFollower(path),
      mergeSessionChange: (batch, changedSession) => ({
        ...batch,
        reset: batch.reset || changedSession,
        changed: batch.changed || changedSession,
      }),
      noStreamBatch: (reset) => ({
        market: [],
        stall: [],
        invalidLines: 0,
        missing: true,
        reset,
        changed: reset,
        status: "waiting",
      }),
    });
  }

  poll(): Promise<MarketSourceBatch> {
    return this.inner.poll();
  }
}
