import { readCurrentLogStream, streamSessionPath } from "@kar-mi/spirit-vale-tools-logging";
import type { LogStream } from "@kar-mi/spirit-vale-tools-logging";
import { openReadModel } from "@kar-mi/spirit-vale-tools-sqlite";
import type { ReadModel } from "@kar-mi/spirit-vale-tools-sqlite";
import { createCombatDomain, indexCombatStream } from "@kar-mi/spirit-vale-tools-combat";
import { createRewardsDomain, indexRewardStream } from "@kar-mi/spirit-vale-tools-rewards";

const INDEX_INTERVAL_MS = 5_000;

export interface IndexSessionResult {
  ok: boolean;
  finalized: boolean;
}

export interface ReadModelService {
  model(): ReadModel | undefined;
  acquire(): () => void;
  indexSession(
    sessionId: string,
    stream: "combat" | "rewards",
    options?: { finalize?: boolean },
  ): Promise<IndexSessionResult>;
  close(): Promise<void>;
}

export async function createReadModelService(
  options: { logDirectory: string; indexIntervalMs?: number },
): Promise<ReadModelService> {
  let model: ReadModel | undefined;
  try {
    model = await openReadModel({
      logDirectory: options.logDirectory,
      domains: [createCombatDomain(), createRewardsDomain()],
      onRebuild: (event) => {
        console.warn("[spiritvale-readmodel]", `rebuilt ${event.domain ?? "database"} (${event.reason})`, event.detail ?? "");
      },
    });
  } catch (error) {
    console.error("[spiritvale-readmodel]", `unavailable: ${errorMessage(error)}`);
  }

  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(run: () => Promise<T>, fallback: T): Promise<T> {
    const next = queue.then(() => (closed ? fallback : run()), () => fallback);
    queue = next.then(() => undefined, () => undefined);
    return next;
  }

  let consumers = 0;

  const timer = model
    ? setInterval(() => void indexActiveSession(), options.indexIntervalMs ?? INDEX_INTERVAL_MS)
    : undefined;

  async function indexActiveSession(): Promise<void> {
    if (closed || !model || consumers === 0) return;
    for (const stream of ["combat", "rewards"] as const) {
      const current = await currentSessionId(stream);
      if (current === undefined) continue;
      await enqueue(() => runIndex(current, stream, false), undefined);
    }
  }

  async function currentSessionId(stream: LogStream): Promise<string | undefined> {
    try {
      const pointer = await readCurrentLogStream(stream, options.logDirectory);
      return pointer?.sessionId;
    } catch {
      return undefined;
    }
  }

  async function runIndex(sessionId: string, stream: "combat" | "rewards", finalize: boolean): Promise<boolean> {
    if (!model) return false;
    const sourcePath = streamSessionPath(stream, sessionId, options.logDirectory);
    try {
      const result = stream === "combat"
        ? await indexCombatStream(model, { sessionId, sourcePath, finalize })
        : await indexRewardStream(model, { sessionId, sourcePath });
      return !result.missing;
    } catch (error) {
      console.error("[spiritvale-readmodel]", `${stream} indexing failed: ${errorMessage(error)}`);
      return false;
    }
  }

  return {
    model: () => model,
    acquire() {
      consumers += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        consumers = Math.max(0, consumers - 1);
      };
    },
    async indexSession(sessionId, stream, indexOptions) {
      const current = await currentSessionId(stream);
      // Keep the active encounter open for the next indexing pass.
      const finalize = (indexOptions?.finalize ?? true) && current !== sessionId;
      const ok = await enqueue(() => runIndex(sessionId, stream, finalize), false);
      return { ok, finalized: ok && finalize };
    },
    async close() {
      if (closed) return;
      closed = true;
      if (timer) clearInterval(timer);
      // Let an in-flight pass finish its transaction rather than closing the database underneath it.
      await queue.catch(() => undefined);
      try {
        model?.close();
      } catch (error) {
        console.error("[spiritvale-readmodel]", `close failed: ${errorMessage(error)}`);
      }
      model = undefined;
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
