import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeJsonFileAtomic } from "./json-settings.ts";
import { isSpiritValeLocation, type SpiritValeLocation } from "./location.ts";

interface CachedSessionSummary {
  size: number;
  mtimeMs: number;
  recordCount: number;
  summary: string;
  locations: SpiritValeLocation[];
}

interface SummaryCacheFile {
  schemaVersion: 3;
  entries: Record<string, CachedSessionSummary>;
}

export interface SessionSummaryResult {
  recordCount: number;
  summary: string;
  locations?: SpiritValeLocation[];
}

export interface SessionSummaryCache {
  get(filePath: string, stat: { size: number; mtimeMs: number }): SessionSummaryResult | undefined;
  set(filePath: string, stat: { size: number; mtimeMs: number }, result: SessionSummaryResult): void;
  prune(keepPaths: ReadonlySet<string>): void;
  save(): Promise<void>;
}

export async function loadSessionSummaryCache(cachePath: string): Promise<SessionSummaryCache> {
  const entries = await readCacheFile(cachePath);
  return {
    get(filePath, stat) {
      const key = path.resolve(filePath);
      const cached = entries[key];
      if (!cached || cached.size !== stat.size || cached.mtimeMs !== stat.mtimeMs) return undefined;
      return { recordCount: cached.recordCount, summary: cached.summary, locations: cached.locations };
    },
    set(filePath, stat, result) {
      const key = path.resolve(filePath);
      entries[key] = { size: stat.size, mtimeMs: stat.mtimeMs, recordCount: result.recordCount, summary: result.summary, locations: result.locations ?? [] };
    },
    prune(keepPaths) {
      for (const key of Object.keys(entries)) {
        if (!keepPaths.has(key)) delete entries[key];
      }
    },
    async save() {
      const file: SummaryCacheFile = { schemaVersion: 3, entries };
      await writeJsonFileAtomic(cachePath, file, { pretty: false, uniqueTemp: true });
    },
  };
}

async function readCacheFile(cachePath: string): Promise<Record<string, CachedSessionSummary>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(cachePath, "utf8"));
    if (!isSummaryCacheFile(parsed)) return {};
    return parsed.entries;
  } catch {
    return {};
  }
}

function isSummaryCacheFile(value: unknown): value is SummaryCacheFile {
  if (!isRecord(value) || value["schemaVersion"] !== 3 || !isRecord(value["entries"])) return false;
  return Object.values(value["entries"]).every(isCachedSessionSummary);
}

function isCachedSessionSummary(value: unknown): value is CachedSessionSummary {
  return isRecord(value)
    && typeof value["size"] === "number"
    && typeof value["mtimeMs"] === "number"
    && typeof value["recordCount"] === "number"
    && typeof value["summary"] === "string"
    && Array.isArray(value["locations"])
    && value["locations"].every(isSpiritValeLocation);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
