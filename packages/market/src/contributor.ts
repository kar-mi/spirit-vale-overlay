import { CURRENT_GAME_BUILD_FINGERPRINT, type CapturedFishNetPacket } from "@kar-mi/spirit-vale-tools-capture";
import { FishNetMarketTracker } from "@kar-mi/spirit-vale-tools-market";
import { loadJsonSettings, writeJsonFileAtomic } from "@svoverlay/desktop-platform/json-settings";
import {
  MARKET_API_URL,
  MARKET_PACKAGE_VERSION,
  MARKET_PROTOCOL_VERSION,
  type MarketObservationBatch,
  type MarketUploadObservation,
  type MarketUploadStat,
} from "./contracts.ts";
import { isRecord } from "./guards.ts";
import { normalizeMarketEvent } from "./normalizer.ts";

const FLUSH_OBSERVATIONS = 50;
const MAX_BATCH_OBSERVATIONS = 100;
const FLUSH_INTERVAL_MS = 7_500;
const MAX_REQUEST_BYTES = 240 * 1024;
const MAX_RECENT_KEYS = 20_000;
const MAX_RETRY_MS = 5 * 60 * 1_000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const HASH = /^[0-9a-f]{64}$/;
const JSON_ENCODER = new TextEncoder();

interface StoredBatch {
  batch: MarketObservationBatch;
  attempts: number;
  nextAttemptAt: string;
  lastError?: string;
}

interface ContributorState {
  schemaVersion: 1;
  installationToken?: string;
  outbox: StoredBatch[];
  recentKeys: string[];
}

export interface MarketContributorOptions {
  statePath: string;
  enabled: boolean;
  collectorVersion: string;
  endpoint?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  onWarning?: (warning: string) => void;
}

export class MarketContributor {
  private readonly tracker = new FishNetMarketTracker();
  private readonly pending = new Map<string, MarketUploadObservation>();
  private readonly recent = new Set<string>();
  private readonly recentOrder: string[];
  private readonly endpoint: string;
  private readonly fetch: typeof fetch;
  private readonly now: () => Date;
  private operations: Promise<void> = Promise.resolve();
  private flushTimer?: ReturnType<typeof setTimeout>;
  private accepting = true;
  private uploadTimer?: ReturnType<typeof setTimeout>;
  private enabled: boolean;
  private stopped = false;

  private constructor(
    private readonly options: MarketContributorOptions,
    private readonly state: ContributorState,
  ) {
    this.enabled = options.enabled;
    this.endpoint = (options.endpoint ?? MARKET_API_URL).replace(/\/$/, "");
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
    this.recentOrder = [...state.recentKeys];
    for (const key of this.recentOrder) this.recent.add(key);
    if (this.enabled && this.state.outbox.length > 0) this.scheduleUpload(0);
  }

  static async load(options: MarketContributorOptions): Promise<MarketContributor> {
    const state = await loadJsonSettings(options.statePath, parseState, emptyState);
    return new MarketContributor(options, state);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      clearTimeout(this.flushTimer);
      clearTimeout(this.uploadTimer);
      this.flushTimer = undefined;
      this.uploadTimer = undefined;
      this.pending.clear();
      this.state.outbox = [];
      this.enqueue(() => this.persist());
      return;
    }
    if (!this.accepting) return;
    if (this.pending.size > 0) this.scheduleFlush();
    if (this.state.outbox.length > 0) this.scheduleUpload(0);
  }

  consume(packet: CapturedFishNetPacket): void {
    if (!this.enabled || !this.accepting) return;
    let events;
    try {
      events = this.tracker.consume(packet);
    } catch (error) {
      this.warn(`Could not decode a verified market packet: ${errorMessage(error)}`);
      return;
    }
    if (events.length === 0) return;
    this.enqueue(async () => {
      if (!this.enabled || this.stopped) return;
      for (const event of events) {
        const observations = await normalizeMarketEvent(event, this.now());
        for (const observation of observations) this.addObservation(observation);
      }
      if (this.pending.size >= FLUSH_OBSERVATIONS) {
        await this.flushPending();
        await this.uploadOutbox();
      } else if (this.pending.size > 0) {
        this.scheduleFlush();
      }
    });
  }

  async shutdown(): Promise<void> {
    this.accepting = false;
    clearTimeout(this.flushTimer);
    clearTimeout(this.uploadTimer);
    this.flushTimer = undefined;
    this.uploadTimer = undefined;
    await this.operations;
    this.stopped = true;
    clearTimeout(this.flushTimer);
    clearTimeout(this.uploadTimer);
    this.flushTimer = undefined;
    this.uploadTimer = undefined;
    if (this.pending.size > 0) await this.flushPending();
    else await this.persist();
  }

  private addObservation(observation: MarketUploadObservation): void {
    const key = deduplicationKey(observation);
    if (this.recent.has(key) || this.pending.has(key)) return;
    this.pending.set(key, observation);
    this.recent.add(key);
    this.recentOrder.push(key);
    while (this.recentOrder.length > MAX_RECENT_KEYS) {
      const removed = this.recentOrder.shift();
      if (removed !== undefined) this.recent.delete(removed);
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined || this.stopped || !this.enabled) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.enqueue(async () => {
        if (!this.enabled || this.stopped) return;
        await this.flushPending();
        await this.uploadOutbox();
      });
    }, FLUSH_INTERVAL_MS);
  }

  private scheduleUpload(delayMs: number): void {
    if (this.stopped || !this.enabled) return;
    clearTimeout(this.uploadTimer);
    this.uploadTimer = setTimeout(() => {
      this.uploadTimer = undefined;
      this.enqueue(async () => {
        if (this.enabled && !this.stopped) await this.uploadOutbox();
      });
    }, delayMs);
  }

  private enqueue(operation: () => Promise<void>): void {
    this.operations = this.operations.then(operation).catch((error) => {
      this.warn(errorMessage(error));
    });
  }

  private async flushPending(): Promise<void> {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    while (this.pending.size > 0) {
      const observations: MarketUploadObservation[] = [];
      const selectedKeys: string[] = [];
      for (const [key, observation] of this.pending) {
        const candidate = [...observations, observation];
        const batch = this.createBatch(candidate);
        if (JSON_ENCODER.encode(JSON.stringify(batch)).byteLength > MAX_REQUEST_BYTES) {
          if (observations.length === 0) throw new Error("One normalized market observation exceeds the upload request limit");
          break;
        }
        observations.push(observation);
        selectedKeys.push(key);
        if (observations.length >= MAX_BATCH_OBSERVATIONS) break;
      }
      const batch = this.createBatch(observations);
      this.state.outbox.push({ batch, attempts: 0, nextAttemptAt: this.now().toISOString() });
      for (const key of selectedKeys) this.pending.delete(key);
    }
    this.state.recentKeys = [...this.recentOrder];
    await this.persist();
  }

  private createBatch(observations: MarketUploadObservation[]): MarketObservationBatch {
    return {
      protocolVersion: MARKET_PROTOCOL_VERSION,
      batchId: crypto.randomUUID(),
      marketId: "global",
      sentAt: this.now().toISOString(),
      collector: {
        version: this.options.collectorVersion,
        gameBuild: CURRENT_GAME_BUILD_FINGERPRINT,
        marketPackageVersion: MARKET_PACKAGE_VERSION,
      },
      observations,
    };
  }

  private async uploadOutbox(): Promise<void> {
    while (this.enabled && !this.stopped && this.state.outbox.length > 0) {
      const entry = this.state.outbox[0]!;
      const delay = Date.parse(entry.nextAttemptAt) - this.now().getTime();
      if (delay > 0) {
        this.scheduleUpload(delay);
        return;
      }

      try {
        const token = await this.installationToken();
        const response = await this.fetch(`${this.endpoint}/v2/observations`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(entry.batch),
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        if (response.status === 202) {
          this.state.outbox.shift();
          await this.persist();
          continue;
        }
        if (response.status === 401) this.state.installationToken = undefined;
        await this.deferEntry(entry, `Market upload returned HTTP ${response.status}`);
      } catch (error) {
        await this.deferEntry(entry, `Market upload failed: ${errorMessage(error)}`);
      }
      return;
    }
  }

  private async installationToken(): Promise<string> {
    if (this.state.installationToken !== undefined) return this.state.installationToken;
    const response = await this.fetch(`${this.endpoint}/v2/installations`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 201) throw new Error(`Contributor registration returned HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (!isRecord(body) || typeof body.token !== "string" || !TOKEN.test(body.token)) {
      throw new Error("Contributor registration returned an invalid token");
    }
    this.state.installationToken = body.token;
    await this.persist();
    return body.token;
  }

  private async deferEntry(entry: StoredBatch, message: string): Promise<void> {
    entry.attempts += 1;
    entry.lastError = message;
    const delay = Math.min(MAX_RETRY_MS, 1_000 * (2 ** Math.min(entry.attempts - 1, 8)));
    entry.nextAttemptAt = new Date(this.now().getTime() + delay).toISOString();
    await this.persist();
    this.warn(message);
    this.scheduleUpload(delay);
  }

  private async persist(): Promise<void> {
    await writeJsonFileAtomic(this.options.statePath, this.state, { pretty: false, uniqueTemp: true });
  }

  private warn(message: string): void {
    this.options.onWarning?.(message);
  }
}

function emptyState(): ContributorState {
  return { schemaVersion: 1, outbox: [], recentKeys: [] };
}

function parseState(value: unknown): ContributorState {
  if (!isRecord(value) || value.schemaVersion !== 1) return emptyState();
  const installationToken = typeof value.installationToken === "string" && TOKEN.test(value.installationToken)
    ? value.installationToken
    : undefined;
  const outbox = Array.isArray(value.outbox)
    ? value.outbox.map(parseStoredBatch).filter((entry): entry is StoredBatch => entry !== undefined)
    : [];
  const recentKeys = Array.isArray(value.recentKeys)
    ? value.recentKeys.filter((entry): entry is string => typeof entry === "string" && deduplicationKeyPattern(entry))
      .slice(-MAX_RECENT_KEYS)
    : [];
  return {
    schemaVersion: 1,
    ...(installationToken === undefined ? {} : { installationToken }),
    outbox,
    recentKeys,
  };
}
function parseStoredBatch(value: unknown): StoredBatch | undefined {
  if (!isRecord(value) || !isRecord(value.batch)) return undefined;
  const batch = value.batch;
  const rawObservations = batch.observations;
  if (!Array.isArray(rawObservations)
    || batch.protocolVersion !== MARKET_PROTOCOL_VERSION
    || typeof batch.batchId !== "string"
    || typeof batch.marketId !== "string"
    || typeof batch.sentAt !== "string"
    || !isRecord(batch.collector)
    || typeof batch.collector.version !== "string"
    || typeof batch.collector.gameBuild !== "string"
    || typeof batch.collector.marketPackageVersion !== "string") return undefined;
  const observations = rawObservations.map(parseObservation);
  if (observations.length < 1 || observations.length > MAX_BATCH_OBSERVATIONS || observations.some((row) => row === undefined)) {
    return undefined;
  }
  const attempts = Number.isSafeInteger(value.attempts) && (value.attempts as number) >= 0 ? value.attempts as number : 0;
  const nextAttemptAt = typeof value.nextAttemptAt === "string" && Number.isFinite(Date.parse(value.nextAttemptAt))
    ? value.nextAttemptAt
    : new Date(0).toISOString();
  const restored: MarketObservationBatch = {
    protocolVersion: MARKET_PROTOCOL_VERSION,
    batchId: batch.batchId,
    marketId: batch.marketId,
    sentAt: batch.sentAt,
    collector: {
      version: batch.collector.version,
      gameBuild: batch.collector.gameBuild,
      marketPackageVersion: batch.collector.marketPackageVersion,
    },
    observations: observations as MarketUploadObservation[],
  };
  return {
    batch: restored,
    attempts,
    nextAttemptAt,
    ...(typeof value.lastError === "string" ? { lastError: value.lastError } : {}),
  };
}

function parseObservation(value: unknown): MarketUploadObservation | undefined {
  if (!isRecord(value)
    || typeof value.reportId !== "string"
    || typeof value.listingKey !== "string" || !HASH.test(value.listingKey)
    || !Number.isSafeInteger(value.listingVersion) || (value.listingVersion as number) < 0
    || typeof value.payloadHash !== "string" || !HASH.test(value.payloadHash)
    || !Number.isSafeInteger(value.itemType) || (value.itemType as number) < 0
    || typeof value.itemId !== "string"
    || (value.displayName !== null && typeof value.displayName !== "string")
    || !Number.isSafeInteger(value.unitPrice) || (value.unitPrice as number) < 0
    || !Number.isSafeInteger(value.quantity) || (value.quantity as number) < 0
    || !Number.isSafeInteger(value.status) || (value.status as number) < 0
    || !Array.isArray(value.stats)
    || typeof value.observedAt !== "string"
    || (value.expiresAt !== null && typeof value.expiresAt !== "string")) return undefined;
  const stats = value.stats.map(parseStat);
  if (stats.some((stat) => stat === undefined)) return undefined;
  return {
    reportId: value.reportId,
    listingKey: value.listingKey,
    listingVersion: value.listingVersion as number,
    payloadHash: value.payloadHash,
    itemType: value.itemType as number,
    itemId: value.itemId,
    displayName: value.displayName,
    unitPrice: value.unitPrice as number,
    quantity: value.quantity as number,
    status: value.status as number,
    stats: stats as MarketUploadStat[],
    observedAt: value.observedAt,
    expiresAt: value.expiresAt,
  };
}

function parseStat(value: unknown): MarketUploadStat | undefined {
  if (!isRecord(value)
    || !Number.isSafeInteger(value.type)
    || typeof value.percent !== "boolean"
    || (value.name !== undefined && typeof value.name !== "string")
    || (value.value !== undefined && (typeof value.value !== "number" || !Number.isFinite(value.value)))) return undefined;
  return {
    type: value.type as number,
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.value === "number" ? { value: value.value } : {}),
    percent: value.percent,
  };
}

function deduplicationKey(observation: MarketUploadObservation): string {
  return `${observation.listingKey}:${observation.listingVersion}:${observation.payloadHash}`;
}

function deduplicationKeyPattern(value: string): boolean {
  const parts = value.split(":");
  return parts.length === 3 && HASH.test(parts[0] ?? "") && /^(0|[1-9]\d*)$/.test(parts[1] ?? "") && HASH.test(parts[2] ?? "");
}


function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
