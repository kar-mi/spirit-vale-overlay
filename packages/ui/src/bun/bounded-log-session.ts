import { open } from "node:fs/promises";
import { Buffer } from "node:buffer";

import {
  createLogSession,
  sanitizeCombatData,
  sessionStreamPath,
} from "@kar-mi/spirit-vale-tools-logging";
import type {
  JsonObject,
  LogSession,
  LogStream,
  LogWriteFailure,
} from "@kar-mi/spirit-vale-tools-logging";

const FLUSH_INTERVAL_MS = 50;
const BATCH_BYTES = 256 * 1024;
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

export interface LogWriter {
  log(type: string, data: JsonObject): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export interface BoundedLogSession extends Pick<LogSession, "id" | "directory"> {
  logger(stream: LogStream): LogWriter;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export async function createBoundedLogSession(options: {
  producer: string;
  streams: readonly LogStream[];
  logDirectory: string;
  activate?: boolean;
  onWriteError?: (failure: LogWriteFailure) => void;
}): Promise<BoundedLogSession> {
  // Reuse the upstream package for metadata, paths, collision-safe ids, and pointer activation.
  // Its loggers remain empty; this wrapper owns all writes to the files it created.
  const base = await createLogSession(options);
  const writers = new Map<LogStream, BoundedJsonLinesWriter>();
  for (const stream of options.streams) {
    writers.set(stream, new BoundedJsonLinesWriter(
      sessionStreamPath(base.id, stream, options.logDirectory),
      base.id,
      options.producer,
      stream,
      options.onWriteError,
    ));
  }
  return {
    id: base.id,
    directory: base.directory,
    logger(stream) {
      const writer = writers.get(stream);
      if (!writer) throw new Error(`stream ${stream} is not part of session ${base.id}`);
      return writer;
    },
    async flush() {
      await Promise.all([...writers.values()].map((writer) => writer.flush()));
    },
    async close() {
      await Promise.all([...writers.values()].map((writer) => writer.close()));
      await base.close();
    },
  };
}

class BoundedJsonLinesWriter implements LogWriter {
  private sequence = 0;
  private lines: string[] = [];
  private currentBytes = 0;
  private bufferedBytes = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private tail: Promise<void> = Promise.resolve();
  private readonly handle;
  private firstFailure?: Error;
  private closed = false;

  constructor(
    private readonly path: string,
    private readonly sessionId: string,
    private readonly source: string,
    private readonly stream: LogStream,
    private readonly onWriteError?: (failure: LogWriteFailure) => void,
  ) {
    this.handle = open(path, "a");
  }

  log(type: string, data: JsonObject): void {
    if (this.closed || this.firstFailure) return;
    const safeData = this.stream === "combat" ? sanitizeCombatData(type, data) : data;
    if (!safeData) return;
    const line = `${JSON.stringify({
      schemaVersion: 1,
      sessionId: this.sessionId,
      sequence: ++this.sequence,
      recordedAt: new Date().toISOString(),
      source: this.source,
      type,
      data: safeData,
    })}\n`;
    const bytes = Buffer.byteLength(line);
    if (this.bufferedBytes + bytes > MAX_BUFFERED_BYTES) {
      this.fail(new Error(`log buffer exceeded ${MAX_BUFFERED_BYTES} bytes`));
      return;
    }
    this.lines.push(line);
    this.currentBytes += bytes;
    this.bufferedBytes += bytes;
    if (this.currentBytes >= BATCH_BYTES) this.enqueueCurrent();
    else this.scheduleFlush();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.enqueueCurrent();
    await this.tail;
    const handle = await this.handle;
    await handle.close();
    this.lines = [];
    this.currentBytes = 0;
    this.bufferedBytes = 0;
    if (this.firstFailure) throw this.firstFailure;
  }

  async flush(): Promise<void> {
    if (this.closed) return this.tail;
    this.enqueueCurrent();
    await this.tail;
    if (this.firstFailure) throw this.firstFailure;
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.enqueueCurrent();
    }, FLUSH_INTERVAL_MS);
  }

  private enqueueCurrent(): void {
    if (this.lines.length === 0) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const text = this.lines.join("");
    const bytes = this.currentBytes;
    this.lines = [];
    this.currentBytes = 0;
    this.tail = this.tail.then(async () => {
      const handle = await this.handle;
      await handle.appendFile(text, "utf8");
    }).catch((error: unknown) => {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }).finally(() => {
      this.bufferedBytes = Math.max(0, this.bufferedBytes - bytes);
    });
  }

  private fail(error: Error): void {
    if (this.firstFailure) return;
    this.firstFailure = error;
    try { this.onWriteError?.({ stream: this.stream, path: this.path, error }); } catch { /* Reporting is best effort. */ }
  }
}
