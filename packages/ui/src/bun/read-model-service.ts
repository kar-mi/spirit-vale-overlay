import { readCurrentLogStream, sessionStreamPath } from "@kar-mi/spirit-vale-tools-logging";
import type { LogStream } from "@kar-mi/spirit-vale-tools-logging";
import { openReadModel } from "@kar-mi/spirit-vale-tools-sqlite";
import type { ReadModel } from "@kar-mi/spirit-vale-tools-sqlite";
import { createCombatDomain, indexCombatStream } from "@kar-mi/spirit-vale-tools-combat";
import { createRewardsDomain, indexRewardStream } from "@kar-mi/spirit-vale-tools-rewards";

const INDEX_INTERVAL_MS = 1_000;

export interface IndexSessionResult {
  /** False when the read model is unavailable, the log is missing, or the pass failed. */
  ok: boolean;
  /**
   * Whether the trailing encounter was closed. Refused for the session currently being captured,
   * however the caller asked, because that log can still grow.
   */
  finalized: boolean;
}

export interface ReadModelService {
  /** Undefined while the read model is unavailable; callers fall back to reading JSON Lines. */
  model(): ReadModel | undefined;
  /**
   * Indexes one session's stream on demand, for a window opening a log the live tick does not
   * follow. Serialised against the periodic pass and every other caller.
   */
  indexSession(
    sessionId: string,
    stream: "combat" | "rewards",
    options?: { finalize?: boolean },
  ): Promise<IndexSessionResult>;
  close(): Promise<void>;
}

/**
 * Owns the one SQLite read model for the whole desktop process and keeps the active session's
 * combat and rewards logs indexed into it.
 *
 * The database is a disposable cache derived from the JSON Lines logs, which stay canonical. Every
 * failure here is therefore non-fatal: opening or indexing can fail, and each consumer falls back
 * to the in-memory follower it used before.
 */
export async function createReadModelService(options: { logDirectory: string }): Promise<ReadModelService> {
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
  /**
   * Every pass runs through here, periodic and on demand alike. Two passes over the same stream must
   * never interleave: one finalizing the trailing encounter while another rewrites it open leaves
   * the result decided by whichever finishes last.
   */
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(run: () => Promise<T>, fallback: T): Promise<T> {
    const next = queue.then(() => (closed ? fallback : run()), () => fallback);
    queue = next.then(() => undefined, () => undefined);
    return next;
  }

  const timer = model
    ? setInterval(() => void indexActiveSession(), INDEX_INTERVAL_MS)
    : undefined;
  timer?.unref?.();

  async function indexActiveSession(): Promise<void> {
    if (closed || !model) return;
    for (const stream of ["combat", "rewards"] as const) {
      const current = await currentSessionId(stream);
      if (current === undefined) continue;
      // The active log keeps growing, so never finalize: the trailing encounter must stay open for
      // the next pass to continue instead of being closed and restarted.
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
    const sourcePath = sessionStreamPath(sessionId, stream, options.logDirectory);
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
    async indexSession(sessionId, stream, indexOptions) {
      // Finalizing is decided here rather than by the caller: only this service knows whether the
      // requested session is the one still being captured, and closing that session's open
      // encounter would split a fight in two once live indexing resumes.
      const current = await currentSessionId(stream);
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
