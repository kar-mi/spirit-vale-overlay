import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { LogStream } from "@kar-mi/spirit-vale-tools-logging";
import { isSpiritValeLocation, type SpiritValeLocation } from "./location.ts";

export type SummaryStream = Extract<LogStream, "combat" | "rewards">;

export interface SessionSummaryResult {
  recordCount: number;
  summary: string;
  locations?: SpiritValeLocation[];
}

export interface SessionSummaryEntry extends SessionSummaryResult {
  schemaVersion: 1;
  sessionId: string;
  stream: SummaryStream;
}

export interface SessionSummaryJournal {
  get(sessionId: string, stream: SummaryStream): SessionSummaryResult | undefined;
  ensure(
    sessionId: string,
    stream: SummaryStream,
    options: { persist: boolean; calculate: () => Promise<SessionSummaryResult> },
  ): Promise<SessionSummaryResult>;
  append(sessionId: string, stream: SummaryStream, result: SessionSummaryResult): Promise<void>;
}

const journals = new Map<string, Promise<SessionSummaryJournal>>();

export function loadSessionSummaryJournal(logDirectory: string): Promise<SessionSummaryJournal> {
  const journalPath = path.resolve(logDirectory, "summary.jsonl");
  let journal = journals.get(journalPath);
  if (!journal) {
    journal = openSessionSummaryJournal(journalPath);
    journals.set(journalPath, journal);
  }
  return journal;
}

async function openSessionSummaryJournal(journalPath: string): Promise<SessionSummaryJournal> {
  const entries = await readJournal(journalPath);
  const calculations = new Map<string, Promise<SessionSummaryResult>>();
  let writes = Promise.resolve();

  async function appendEntry(sessionId: string, stream: SummaryStream, result: SessionSummaryResult): Promise<void> {
    const entry = normalizedEntry(sessionId, stream, result);
    const key = entryKey(sessionId, stream);
    const write = writes.then(async () => {
      await mkdir(path.dirname(journalPath), { recursive: true });
      await appendFile(journalPath, `${JSON.stringify(entry)}\n`, "utf8");
      entries.set(key, entry);
    });
    writes = write.catch(() => undefined);
    await write;
  }

  return {
    get(sessionId, stream) {
      const entry = entries.get(entryKey(sessionId, stream));
      return entry === undefined ? undefined : summaryResult(entry);
    },
    async ensure(sessionId, stream, options) {
      const key = entryKey(sessionId, stream);
      const cached = entries.get(key);
      if (cached) return summaryResult(cached);

      let calculation = calculations.get(key);
      if (!calculation) {
        calculation = options.calculate().finally(() => calculations.delete(key));
        calculations.set(key, calculation);
      }
      const result = await calculation;
      if (options.persist) {
        const write = writes.then(async () => {
          if (entries.has(key)) return;
          const entry = normalizedEntry(sessionId, stream, result);
          await mkdir(path.dirname(journalPath), { recursive: true });
          await appendFile(journalPath, `${JSON.stringify(entry)}\n`, "utf8");
          entries.set(key, entry);
        });
        writes = write.catch(() => undefined);
        await write;
      }
      return result;
    },
    append: appendEntry,
  };
}

async function readJournal(journalPath: string): Promise<Map<string, SessionSummaryEntry>> {
  const entries = new Map<string, SessionSummaryEntry>();
  let contents: string;
  try {
    contents = await readFile(journalPath, "utf8");
  } catch {
    return entries;
  }
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (!isSessionSummaryEntry(value)) continue;
      entries.set(entryKey(value.sessionId, value.stream), value);
    } catch {
      // A malformed or interrupted append must not hide the remaining valid history.
    }
  }
  return entries;
}

function normalizedEntry(sessionId: string, stream: SummaryStream, result: SessionSummaryResult): SessionSummaryEntry {
  return {
    schemaVersion: 1,
    sessionId,
    stream,
    recordCount: result.recordCount,
    summary: result.summary,
    ...(result.locations === undefined ? {} : { locations: result.locations }),
  };
}

function summaryResult(entry: SessionSummaryEntry): SessionSummaryResult {
  return {
    recordCount: entry.recordCount,
    summary: entry.summary,
    ...(entry.locations === undefined ? {} : { locations: entry.locations }),
  };
}

function entryKey(sessionId: string, stream: SummaryStream): string {
  return `${stream}\0${sessionId}`;
}

function isSessionSummaryEntry(value: unknown): value is SessionSummaryEntry {
  if (!isRecord(value)
    || value["schemaVersion"] !== 1
    || typeof value["sessionId"] !== "string"
    || !value["sessionId"].trim()
    || (value["stream"] !== "combat" && value["stream"] !== "rewards")
    || typeof value["recordCount"] !== "number"
    || !Number.isSafeInteger(value["recordCount"])
    || value["recordCount"] < 0
    || typeof value["summary"] !== "string") return false;
  return value["locations"] === undefined
    || (Array.isArray(value["locations"]) && value["locations"].every(isSpiritValeLocation));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
