import { appendFile, lstat, mkdir, open, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  parseLogStreamHeader,
  readCurrentLogStream,
  streamCategoryDirectory,
  streamSessionPath,
  type LogStream,
} from "@kar-mi/spirit-vale-tools-logging";
import { isSpiritValeLocation, spiritValeLocationKey, type SpiritValeLocation } from "./location.ts";

export type SummaryStream = Extract<LogStream, "combat" | "rewards">;

export const DEFAULT_HISTORY_SESSION_LIMIT = 100;
export const MAX_HISTORY_SESSION_LIMIT = 100_000;

export function normalizeHistorySessionLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_HISTORY_SESSION_LIMIT;
  return Math.min(MAX_HISTORY_SESSION_LIMIT, Math.max(DEFAULT_HISTORY_SESSION_LIMIT, Math.round(value)));
}

export function historyScanLimit(limit: number): number {
  return normalizeHistorySessionLimit(limit) * 3;
}

export interface SessionSummaryResult {
  recordCount: number;
  summary: string;
  locations?: SpiritValeLocation[];
}

export interface IndexedLogSession {
  id: string;
  createdAt: string;
  path: string;
  active: boolean;
  cachedSummary?: SessionSummaryResult;
}

export interface SessionDateRange {
  fromMs?: number;
  toMs?: number;
}

export interface SessionSummaryJournal {
  get(sessionId: string, stream: SummaryStream): SessionSummaryResult | undefined;
  knownLocations(stream: SummaryStream): SpiritValeLocation[];
  list(stream: SummaryStream, options: { limit: number; dateRange?: SessionDateRange }): Promise<IndexedLogSession[]>;
  ensure(
    sessionId: string,
    stream: SummaryStream,
    options: { persist: boolean; createdAt?: string; calculate: () => Promise<SessionSummaryResult> },
  ): Promise<SessionSummaryResult>;
  append(sessionId: string, stream: SummaryStream, result: SessionSummaryResult, createdAt?: string): Promise<void>;
}

interface IndexedEntry {
  createdAt: string;
  result?: SessionSummaryResult;
}

interface SummaryLine extends SessionSummaryResult {
  kind: "summary";
  sessionId: string;
  stream: SummaryStream;
  createdAt: string;
}

interface SessionLine {
  kind: "session";
  sessionId: string;
  stream: SummaryStream;
  createdAt: string;
}

interface DeletedLine {
  kind: "deleted";
  sessionId: string;
  stream: SummaryStream;
}

type JournalLine = SummaryLine | SessionLine | DeletedLine;

const HEADER_PROBE_BYTES = 4096;
const journals = new Map<string, Promise<SessionSummaryJournal>>();

export function loadSessionSummaryJournal(logDirectory: string): Promise<SessionSummaryJournal> {
  const resolvedLogDirectory = path.resolve(logDirectory);
  let journal = journals.get(resolvedLogDirectory);
  if (!journal) {
    journal = openSessionSummaryJournal(resolvedLogDirectory);
    journals.set(resolvedLogDirectory, journal);
  }
  return journal;
}

async function openSessionSummaryJournal(logDirectory: string): Promise<SessionSummaryJournal> {
  const journalPath = path.join(logDirectory, "summary.jsonl");
  const entries = new Map<string, IndexedEntry>();
  const appliedLines = await readJournal(journalPath, entries);
  if (appliedLines > entries.size) await rewriteJournal(journalPath, entries);
  const calculations = new Map<string, Promise<SessionSummaryResult>>();
  const reconciliations = new Map<SummaryStream, Promise<void>>();
  let writes = Promise.resolve();

  async function appendLines(lines: readonly JournalLine[]): Promise<void> {
    if (lines.length === 0) return;
    const write = writes.then(async () => {
      await mkdir(path.dirname(journalPath), { recursive: true });
      await appendFile(journalPath, lines.map((line) => `${JSON.stringify(line)}\n`).join(""), "utf8");
      for (const line of lines) applyLine(line, entries);
    });
    writes = write.catch(() => undefined);
    await write;
  }

  async function reconcile(stream: SummaryStream): Promise<void> {
    let reconciliation = reconciliations.get(stream);
    if (!reconciliation) {
      reconciliation = (async () => {
        await writes;
        const directory = streamCategoryDirectory(stream, logDirectory);
        let directoryEntries;
        try {
          directoryEntries = await readdir(directory, { withFileTypes: true });
        } catch {
          return;
        }
        const fileNames = new Set(directoryEntries
          .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".jsonl"))
          .map((entry) => entry.name));
        const lines: JournalLine[] = [];

        for (const [key] of entries) {
          const parsed = parseEntryKey(key);
          if (parsed.stream !== stream || fileNames.has(`${parsed.sessionId}.jsonl`)) continue;
          lines.push({ kind: "deleted", sessionId: parsed.sessionId, stream });
        }

        for (const fileName of fileNames) {
          const sessionId = fileName.slice(0, -".jsonl".length);
          if (entries.has(entryKey(sessionId, stream))) continue;
          const createdAt = await readSessionCreatedAt(path.join(directory, fileName), sessionId, stream);
          if (createdAt === undefined) continue;
          lines.push({ kind: "session", sessionId, stream, createdAt });
        }
        await appendLines(lines);
      })().finally(() => reconciliations.delete(stream));
      reconciliations.set(stream, reconciliation);
    }
    await reconciliation;
  }

  async function resolvedCreatedAt(sessionId: string, stream: SummaryStream, supplied?: string): Promise<string> {
    if (isIsoDate(supplied)) return supplied;
    const cached = entries.get(entryKey(sessionId, stream))?.createdAt;
    if (cached !== undefined) return cached;
    const discovered = await readSessionCreatedAt(streamSessionPath(stream, sessionId, logDirectory), sessionId, stream);
    if (discovered === undefined) throw new Error(`could not read ${stream} session metadata for ${sessionId}`);
    return discovered;
  }

  return {
    get(sessionId, stream) {
      return pickResult(entries.get(entryKey(sessionId, stream))?.result);
    },
    knownLocations(stream) {
      const seen = new Map<string, SpiritValeLocation>();
      for (const [key, entry] of entries) {
        if (parseEntryKey(key).stream !== stream) continue;
        for (const location of entry.result?.locations ?? []) {
          const zoneKey = spiritValeLocationKey(location);
          if (!seen.has(zoneKey)) seen.set(zoneKey, location);
        }
      }
      return [...seen.values()];
    },
    async list(stream, options) {
      if (!Number.isSafeInteger(options.limit) || options.limit < 0) throw new RangeError("session limit must be a non-negative integer");
      await reconcile(stream);
      const current = await readCurrentLogStream(stream, logDirectory).catch(() => undefined);
      const fromMs = validBoundary(options.dateRange?.fromMs);
      const toMs = validBoundary(options.dateRange?.toMs);
      return [...entries.entries()].flatMap(([key, entry]) => {
        const parsed = parseEntryKey(key);
        if (parsed.stream !== stream || entry.result?.recordCount === 0) return [];
        const createdAtMs = Date.parse(entry.createdAt);
        if (!Number.isFinite(createdAtMs)
          || (fromMs !== undefined && createdAtMs < fromMs)
          || (toMs !== undefined && createdAtMs > toMs)) return [];
        const filePath = streamSessionPath(stream, parsed.sessionId, logDirectory);
        return [{
          id: parsed.sessionId,
          createdAt: entry.createdAt,
          path: filePath,
          active: current?.sessionId === parsed.sessionId && path.resolve(current.path) === path.resolve(filePath),
          ...(entry.result === undefined ? {} : { cachedSummary: pickResult(entry.result) }),
        }];
      }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id))
        .slice(0, options.limit);
    },
    async ensure(sessionId, stream, options) {
      const key = entryKey(sessionId, stream);
      const cached = entries.get(key)?.result;
      if (cached !== undefined) return pickResult(cached);

      let calculation = calculations.get(key);
      if (!calculation) {
        calculation = options.calculate().finally(() => calculations.delete(key));
        calculations.set(key, calculation);
      }
      const result = await calculation;
      if (options.persist && entries.get(key)?.result === undefined) {
        const createdAt = await resolvedCreatedAt(sessionId, stream, options.createdAt);
        const write = writes.then(async () => {
          if (entries.get(key)?.result !== undefined) return;
          await mkdir(path.dirname(journalPath), { recursive: true });
          const line = summaryLine(sessionId, stream, createdAt, result);
          await appendFile(journalPath, `${JSON.stringify(line)}\n`, "utf8");
          applyLine(line, entries);
        });
        writes = write.catch(() => undefined);
        await write;
      }
      return result;
    },
    async append(sessionId, stream, result, suppliedCreatedAt) {
      const createdAt = await resolvedCreatedAt(sessionId, stream, suppliedCreatedAt);
      await appendLines([summaryLine(sessionId, stream, createdAt, result)]);
    },
  };
}

async function readJournal(journalPath: string, entries: Map<string, IndexedEntry>): Promise<number> {
  let contents: string;
  try {
    contents = await readFile(journalPath, "utf8");
  } catch {
    return 0;
  }
  let applied = 0;
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isJournalLine(value)) {
        applyLine(value, entries);
        applied += 1;
      }
    } catch {
      // A malformed or interrupted append must not hide the remaining valid history.
    }
  }
  return applied;
}

async function rewriteJournal(journalPath: string, entries: Map<string, IndexedEntry>): Promise<void> {
  const lines = [...entries.entries()].map(([key, entry]) => {
    const { stream, sessionId } = parseEntryKey(key);
    return entry.result === undefined
      ? { kind: "session", sessionId, stream, createdAt: entry.createdAt } satisfies SessionLine
      : summaryLine(sessionId, stream, entry.createdAt, entry.result);
  });
  try {
    await mkdir(path.dirname(journalPath), { recursive: true });
    const temporary = `${journalPath}.${process.pid}.tmp`;
    await writeFile(temporary, lines.map((line) => `${JSON.stringify(line)}\n`).join(""), "utf8");
    await rename(temporary, journalPath);
  } catch {
    // Compaction is best-effort; an uncompacted journal still loads correctly.
  }
}

function applyLine(line: JournalLine, entries: Map<string, IndexedEntry>): void {
  const key = entryKey(line.sessionId, line.stream);
  if (line.kind === "deleted") {
    entries.delete(key);
    return;
  }
  if (line.kind === "session") {
    entries.set(key, { createdAt: line.createdAt, result: entries.get(key)?.result });
    return;
  }
  entries.set(key, { createdAt: line.createdAt, result: pickResult(line) });
}

async function readSessionCreatedAt(filePath: string, sessionId: string, stream: SummaryStream): Promise<string | undefined> {
  let handle;
  try {
    handle = await open(filePath, "r");
    const buffer = Buffer.alloc(HEADER_PROBE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_PROBE_BYTES, 0);
    const text = buffer.toString("utf8", 0, bytesRead);
    const newline = text.indexOf("\n");
    const candidate: unknown = JSON.parse(newline === -1 ? text : text.slice(0, newline));
    const header = parseLogStreamHeader(candidate);
    if (header !== undefined) {
      return header.sessionId === sessionId && header.stream === stream ? header.startedAt : undefined;
    }
    const info = await lstat(filePath);
    return info.isFile() && !info.isSymbolicLink() ? info.mtime.toISOString() : undefined;
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function summaryLine(sessionId: string, stream: SummaryStream, createdAt: string, result: SessionSummaryResult): SummaryLine {
  return {
    kind: "summary",
    sessionId,
    stream,
    createdAt,
    recordCount: result.recordCount,
    summary: result.summary,
    ...(result.locations === undefined ? {} : { locations: result.locations }),
  };
}

function pickResult(source: SessionSummaryResult): SessionSummaryResult;
function pickResult(source: SessionSummaryResult | undefined): SessionSummaryResult | undefined;
function pickResult(source: SessionSummaryResult | undefined): SessionSummaryResult | undefined {
  if (source === undefined) return undefined;
  return {
    recordCount: source.recordCount,
    summary: source.summary,
    ...(source.locations === undefined ? {} : { locations: source.locations }),
  };
}

function entryKey(sessionId: string, stream: SummaryStream): string {
  return `${stream}\0${sessionId}`;
}

function parseEntryKey(key: string): { stream: SummaryStream; sessionId: string } {
  const separator = key.indexOf("\0");
  return { stream: key.slice(0, separator) as SummaryStream, sessionId: key.slice(separator + 1) };
}

function validBoundary(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isJournalLine(value: unknown): value is JournalLine {
  if (!isRecord(value) || (value["stream"] !== "combat" && value["stream"] !== "rewards")) return false;
  if (typeof value["sessionId"] !== "string" || !value["sessionId"].trim()) return false;
  if (value["kind"] === "deleted") return true;
  if (value["kind"] === "session") return isIsoDate(value["createdAt"]);
  return value["kind"] === "summary" && isIsoDate(value["createdAt"]) && isSummaryFields(value);
}

function isSummaryFields(value: Record<string, unknown>): boolean {
  return typeof value["recordCount"] === "number"
    && Number.isSafeInteger(value["recordCount"])
    && value["recordCount"] >= 0
    && typeof value["summary"] === "string"
    && (value["locations"] === undefined
      || (Array.isArray(value["locations"]) && value["locations"].every(isSpiritValeLocation)));
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
