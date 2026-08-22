import path from "node:path";

import { streamSessionPath } from "@kar-mi/spirit-vale-tools-logging";
import type { LogStream } from "@kar-mi/spirit-vale-tools-logging";

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
