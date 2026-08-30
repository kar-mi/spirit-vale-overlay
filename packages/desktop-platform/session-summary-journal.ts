import { appendFile, lstat, mkdir, open, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  parseLogStreamHeader,
  readCurrentLogStream,
  streamCategoryDirectory,
  streamSessionPath,
  type LogStream,
} from "@kar-mi/spirit-vale-tools-logging";
import { isSpiritValeLocation, type SpiritValeLocation } from "./location.ts";

export type SummaryStream = Extract<LogStream, "combat" | "rewards">;

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
  list(stream: SummaryStream, options: { limit: number; dateRange?: SessionDateRange }): Promise<IndexedLogSession[]>;
  ensure(
    sessionId: string,
    stream: SummaryStream,
    options: { persist: boolean; createdAt?: string; calculate: () => Promise<SessionSummaryResult> },
  ): Promise<SessionSummaryResult>;
  append(sessionId: string, stream: SummaryStream, result: SessionSummaryResult, createdAt?: string): Promise<void>;
}

interface IndexedEntry {
  createdAt?: string;
  result?: SessionSummaryResult;
}

interface LegacySummaryLine extends SessionSummaryResult {
  schemaVersion: 1;
  sessionId: string;
  stream: SummaryStream;
}

interface SummaryLine extends SessionSummaryResult {
  schemaVersion: 2;
  kind: "summary";
  sessionId: string;
  stream: SummaryStream;
  createdAt: string;
}

interface SessionLine {
  schemaVersion: 2;
  kind: "session";
  sessionId: string;
  stream: SummaryStream;
  createdAt: string;
}

interface DeletedLine {
  schemaVersion: 2;
  kind: "deleted";
  sessionId: string;
  stream: SummaryStream;
}

interface CheckpointLine {
  schemaVersion: 2;
  kind: "checkpoint";
  stream: SummaryStream;
  directoryMtimeMs: number;
}

type JournalLine = LegacySummaryLine | SummaryLine | SessionLine | DeletedLine | CheckpointLine;

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
  const checkpoints = new Map<SummaryStream, number>();
  await readJournal(journalPath, entries, checkpoints);
  const calculations = new Map<string, Promise<SessionSummaryResult>>();
  const reconciliations = new Map<SummaryStream, Promise<void>>();
  let writes = Promise.resolve();

  async function appendLines(lines: readonly JournalLine[]): Promise<void> {
    if (lines.length === 0) return;
    const write = writes.then(async () => {
      await mkdir(path.dirname(journalPath), { recursive: true });
      await appendFile(journalPath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
      for (const line of lines) applyLine(line, entries, checkpoints);
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
        let directoryInfo;
        try {
          directoryInfo = await stat(directory);
        } catch {
          return;
        }
        if (checkpoints.get(stream) === directoryInfo.mtimeMs) return;

        const directoryEntries = await readdir(directory, { withFileTypes: true });
        const fileNames = new Set(directoryEntries
          .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".jsonl"))
          .map((entry) => entry.name));
        const lines: JournalLine[] = [];

        for (const [key] of entries) {
          const parsed = parseEntryKey(key);
          if (parsed.stream !== stream || fileNames.has(`${parsed.sessionId}.jsonl`)) continue;
          lines.push({ schemaVersion: 2, kind: "deleted", sessionId: parsed.sessionId, stream });
        }

        for (const fileName of fileNames) {
          const sessionId = fileName.slice(0, -".jsonl".length);
          if (entries.get(entryKey(sessionId, stream))?.createdAt !== undefined) continue;
          const createdAt = await readSessionCreatedAt(path.join(directory, fileName), sessionId, stream);
          if (createdAt === undefined) continue;
          lines.push({ schemaVersion: 2, kind: "session", sessionId, stream, createdAt });
        }
        lines.push({ schemaVersion: 2, kind: "checkpoint", stream, directoryMtimeMs: directoryInfo.mtimeMs });
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
      return copyResult(entries.get(entryKey(sessionId, stream))?.result);
    },
    async list(stream, options) {
      if (!Number.isSafeInteger(options.limit) || options.limit < 0) throw new RangeError("session limit must be a non-negative integer");
      await reconcile(stream);
      const current = await readCurrentLogStream(stream, logDirectory).catch(() => undefined);
      const fromMs = validBoundary(options.dateRange?.fromMs);
      const toMs = validBoundary(options.dateRange?.toMs);
      return [...entries.entries()].flatMap(([key, entry]) => {
        const parsed = parseEntryKey(key);
        if (parsed.stream !== stream || entry.createdAt === undefined || entry.result?.recordCount === 0) return [];
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
          ...(entry.result === undefined ? {} : { cachedSummary: copyResult(entry.result) }),
        }];
      }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id))
        .slice(0, options.limit);
    },
    async ensure(sessionId, stream, options) {
      const key = entryKey(sessionId, stream);
      const cached = entries.get(key)?.result;
      if (cached !== undefined) return copyResult(cached)!;

      let calculation = calculations.get(key);
      if (!calculation) {
        calculation = options.calculate().finally(() => calculations.delete(key));
        calculations.set(key, calculation);
      }
      const result = await calculation;
      if (options.persist) {
        const createdAt = await resolvedCreatedAt(sessionId, stream, options.createdAt);
        const write = writes.then(async () => {
          if (entries.get(key)?.result !== undefined) return;
          const line = summaryLine(sessionId, stream, createdAt, result);
          await mkdir(path.dirname(journalPath), { recursive: true });
          await appendFile(journalPath, `${JSON.stringify(line)}\n`, "utf8");
          applyLine(line, entries, checkpoints);
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

async function readJournal(
  journalPath: string,
  entries: Map<string, IndexedEntry>,
  checkpoints: Map<SummaryStream, number>,
): Promise<void> {
  let contents: string;
  try {
    contents = await readFile(journalPath, "utf8");
  } catch {
    return;
  }
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isJournalLine(value)) applyLine(value, entries, checkpoints);
    } catch {
      // A malformed or interrupted append must not hide the remaining valid history.
    }
  }
}

function applyLine(
  line: JournalLine,
  entries: Map<string, IndexedEntry>,
  checkpoints: Map<SummaryStream, number>,
): void {
  if (line.schemaVersion === 2 && line.kind === "checkpoint") {
    checkpoints.set(line.stream, line.directoryMtimeMs);
    return;
  }
  const key = entryKey(line.sessionId, line.stream);
  if (line.schemaVersion === 2 && line.kind === "deleted") {
    entries.delete(key);
    return;
  }
  const previous = entries.get(key) ?? {};
  if (line.schemaVersion === 2 && line.kind === "session") {
    entries.set(key, { ...previous, createdAt: line.createdAt });
    return;
  }
  entries.set(key, {
    ...previous,
    ...(line.schemaVersion === 2 ? { createdAt: line.createdAt } : {}),
    result: resultFromLine(line),
  });
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
    schemaVersion: 2,
    kind: "summary",
    sessionId,
    stream,
    createdAt,
    recordCount: result.recordCount,
    summary: result.summary,
    ...(result.locations === undefined ? {} : { locations: result.locations }),
  };
}

function resultFromLine(line: LegacySummaryLine | SummaryLine): SessionSummaryResult {
  return {
    recordCount: line.recordCount,
    summary: line.summary,
    ...(line.locations === undefined ? {} : { locations: line.locations }),
  };
}

function copyResult(result: SessionSummaryResult | undefined): SessionSummaryResult | undefined {
  return result === undefined ? undefined : {
    recordCount: result.recordCount,
    summary: result.summary,
    ...(result.locations === undefined ? {} : { locations: result.locations }),
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
  if (value["schemaVersion"] === 1) return isSummaryFields(value)
    && typeof value["sessionId"] === "string" && Boolean(value["sessionId"].trim());
  if (value["schemaVersion"] !== 2 || typeof value["kind"] !== "string") return false;
  if (value["kind"] === "checkpoint") return typeof value["directoryMtimeMs"] === "number" && Number.isFinite(value["directoryMtimeMs"]);
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
