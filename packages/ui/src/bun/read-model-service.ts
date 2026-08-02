import { readCurrentLogStream, sessionStreamPath } from "@kar-mi/spirit-vale-tools-logging";
import type { LogStream } from "@kar-mi/spirit-vale-tools-logging";
import { openReadModel } from "@kar-mi/spirit-vale-tools-sqlite";
import type { ReadModel } from "@kar-mi/spirit-vale-tools-sqlite";
import { createCombatDomain, indexCombatStream } from "@kar-mi/spirit-vale-tools-combat";
import { createRewardsDomain, indexRewardStream } from "@kar-mi/spirit-vale-tools-rewards";

const INDEX_INTERVAL_MS = 1_000;

export interface ReadModelService {
  /** Undefined while the read model is unavailable; callers fall back to reading JSON Lines. */
  model(): ReadModel | undefined;
  /**
   * Indexes a past session's stream on demand, for a window opening a log the live tick does not
   * follow. Resolves to false when the read model is unavailable or the pass failed.
   */
  indexSession(sessionId: string, stream: "combat" | "rewards", options?: { finalize?: boolean }): Promise<boolean>;
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

  let indexing = false;
  let closed = false;

  const timer = model
    ? setInterval(() => void indexActiveSession(), INDEX_INTERVAL_MS)
    : undefined;
  timer?.unref?.();

  async function indexActiveSession(): Promise<void> {
    if (indexing || closed || !model) return;
    indexing = true;
    try {
      await indexStream("combat");
      await indexStream("rewards");
    } finally {
      indexing = false;
    }
  }

  async function indexStream(stream: "combat" | "rewards"): Promise<void> {
    const pointer = await currentSession(stream);
    if (!pointer) return;
    // The active log keeps growing, so never finalize: the trailing encounter must stay open for
    // the next pass to continue instead of being closed and restarted.
    await runIndex(pointer.sessionId, stream, false);
  }

  async function currentSession(stream: LogStream): Promise<{ sessionId: string } | undefined> {
    try {
      const pointer = await readCurrentLogStream(stream, options.logDirectory);
      return pointer ? { sessionId: pointer.sessionId } : undefined;
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
    indexSession: (sessionId, stream, indexOptions) => runIndex(sessionId, stream, indexOptions?.finalize ?? true),
    async close() {
      if (closed) return;
      closed = true;
      if (timer) clearInterval(timer);
      // Let an indexing pass finish its transaction rather than closing the database underneath it.
      while (indexing) await new Promise((resolve) => setTimeout(resolve, 10));
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
