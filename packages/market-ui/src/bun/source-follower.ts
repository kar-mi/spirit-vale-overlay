import { JsonlTailReader, LiveLogSessionFollower, parseLogRecord } from "@kar-mi/spirit-vale-tools-logging";
import type { LiveLogStatus } from "@kar-mi/spirit-vale-tools-logging";
import { FishNetMarketTracker, parseMarketEventLogData } from "@kar-mi/spirit-vale-tools-market";
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
        this.market = this.marketTracker.query();
        return;
      case "listings":
        this.stallTracker.apply(event);
        this.stall = this.stallTracker.query();
        return;
      case "stalls":
      case "stallUpsert":
      case "stallRemove":
        // Shop name and map only resolve through each tracker's own stall map, so both need these.
        this.marketTracker.apply(event);
        this.stallTracker.apply(event);
        this.market = this.marketTracker.query();
        this.stall = this.stallTracker.query();
    }
  }

  private captured(): number {
    return this.market.length + this.stall.length;
  }

  private resetState(): void {
    this.marketTracker.reset();
    this.stallTracker.reset();
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
