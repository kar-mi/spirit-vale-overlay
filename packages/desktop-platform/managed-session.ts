import path from "node:path";

import { streamSessionPath } from "@kar-mi/spirit-vale-tools-logging";
import type { LogStream } from "@kar-mi/spirit-vale-tools-logging";

/**
 * The session id for a log inside the managed log directory, or undefined for any other path.
 *
 * The read model is keyed by session id, so a file the user picked from somewhere else on disk has
 * no indexed form and callers fall back to reading it directly.
 */
export function managedSessionId(
  filePath: string,
  stream: LogStream,
  logDirectory: string,
): string | undefined {
  const resolved = path.resolve(filePath);
  const sessionId = path.basename(resolved, ".jsonl");
  if (!sessionId) return undefined;
  return path.resolve(streamSessionPath(stream, sessionId, logDirectory)) === resolved ? sessionId : undefined;
}
