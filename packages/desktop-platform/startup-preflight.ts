import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

export type StartupOperation =
  | "bundle-read"
  | "directory-create"
  | "probe-create"
  | "probe-flush"
  | "probe-rename"
  | "probe-read"
  | "probe-verify"
  | "probe-cleanup";

// - bundle-read: Read a required packaged file such as resources.neu, bun.exe, or the backend JavaScript.
// - directory-create: Create a required data, settings, logs, or runtime directory.
// - probe-create: Create a temporary test file in a writable directory.
// - probe-flush: Force the test file's contents to disk.
// - probe-rename: Atomically rename the file, as used by safe settings saves.
// - probe-read: Reopen and read the renamed file.
// - probe-verify: Confirm the contents match what was written.
// - probe-cleanup: Remove the temporary test file; failure is warning-only.

export interface StartupFailureDetails {
  phase: "bundle" | "storage";
  operation: StartupOperation;
  path: string;
  message: string;
  code?: string;
}

export interface StartupPreflightOptions {
  /** Total attempts for transient bundle reads and storage probes. */
  attempts?: number;
  /** Delay before the second attempt. Later retries use a linear backoff. */
  retryDelayMs?: number;
  /** Receives failures that will be retried. */
  onRetry?: (failure: StartupFailureDetails, attempt: number, attempts: number) => void;
  /** Receives non-fatal failures, currently probe cleanup failures. */
  onWarning?: (warning: StartupFailureDetails) => void;
}

export class StartupPreflightError extends Error {
  readonly details: StartupFailureDetails;

  constructor(details: StartupFailureDetails, options?: ErrorOptions) {
    super(details.message, options);
    this.name = "StartupPreflightError";
    this.details = details;
  }
}

const defaultAttempts = 3;
const defaultRetryDelayMs = 250;

export async function verifyReadableFiles(
  files: readonly string[],
  options: StartupPreflightOptions = {},
): Promise<void> {
  await Promise.all(files.map((file) => retryTransient(async () => {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(file, "r");
      const fileStat = await handle.stat();
      if (!fileStat.isFile() || fileStat.size === 0) {
        throw new Error(fileStat.isFile() ? "The file is empty." : "The path is not a regular file.");
      }
      const sample = Buffer.alloc(1);
      const result = await handle.read(sample, 0, 1, 0);
      if (result.bytesRead !== 1) throw new Error("The file could not be read.");
    } catch (error) {
      throw preflightError("bundle", "bundle-read", file, error);
    } finally {
      await handle?.close().catch(() => {});
    }
  }, options)));
}

export async function verifyWritableDirectories(
  directories: readonly string[],
  options: StartupPreflightOptions = {},
): Promise<void> {
  const unique = new Map<string, string>();
  for (const directory of directories) {
    const resolved = path.resolve(directory);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (!unique.has(key)) unique.set(key, resolved);
  }
  await Promise.all([...unique.values()].map((directory) => verifyWritableDirectory(directory, options)));
}

async function verifyWritableDirectory(directory: string, options: StartupPreflightOptions): Promise<void> {
  await retryTransient(async () => {
    try {
      await mkdir(directory, { recursive: true });
    } catch (error) {
      throw preflightError("storage", "directory-create", directory, error);
    }
  }, options);

  await retryTransient(() => runStorageProbe(directory, options), options);
}

async function runStorageProbe(directory: string, options: StartupPreflightOptions): Promise<void> {
  const token = crypto.randomUUID();
  const created = path.join(directory, `.spirit-vale-startup-${token}.tmp`);
  const renamed = `${created}.ready`;
  let currentPath = created;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let failure: StartupPreflightError | undefined;

  try {
    try {
      handle = await open(created, "wx");
      await handle.writeFile(token, "utf8");
    } catch (error) {
      throw preflightError("storage", "probe-create", created, error);
    }
    try {
      await handle.sync();
    } catch (error) {
      throw preflightError("storage", "probe-flush", created, error);
    } finally {
      await handle.close().catch(() => {});
      handle = undefined;
    }
    try {
      await rename(created, renamed);
      currentPath = renamed;
    } catch (error) {
      throw preflightError("storage", "probe-rename", created, error);
    }
    let content: string;
    try {
      content = await readFile(renamed, "utf8");
    } catch (error) {
      throw preflightError("storage", "probe-read", renamed, error);
    }
    if (content !== token) {
      throw new StartupPreflightError({
        phase: "storage",
        operation: "probe-verify",
        path: renamed,
        message: "The startup storage probe was read back with unexpected contents.",
      });
    }
  } catch (error) {
    failure = error instanceof StartupPreflightError
      ? error
      : preflightError("storage", "probe-verify", currentPath, error);
  } finally {
    if (handle) await handle.close().catch(() => {});
    try {
      await rm(currentPath, { force: true });
      if (currentPath !== created) await rm(created, { force: true });
    } catch (error) {
      // A successful round trip already proved the directory usable. Indexers,
      // sync clients and AV commonly retain the probe briefly, so cleanup must
      // never turn an otherwise successful startup into a fatal failure.
      notify(() => options.onWarning?.(preflightError("storage", "probe-cleanup", currentPath, error).details));
    }
  }
  if (failure) throw failure;
}

async function retryTransient(action: () => Promise<void>, options: StartupPreflightOptions): Promise<void> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? defaultAttempts));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? defaultRetryDelayMs);
  for (let attempt = 1; ; attempt += 1) {
    try {
      await action();
      return;
    } catch (error) {
      if (!(error instanceof StartupPreflightError) || attempt >= attempts) throw error;
      notify(() => options.onRetry?.(error.details, attempt, attempts));
      await delay(retryDelayMs * attempt);
    }
  }
}

function notify(callback: () => void): void {
  try { callback(); } catch {}
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function preflightError(
  phase: StartupFailureDetails["phase"],
  operation: StartupOperation,
  targetPath: string,
  error: unknown,
): StartupPreflightError {
  const cause = error instanceof Error ? error : new Error(String(error));
  const code = typeof (error as NodeJS.ErrnoException | undefined)?.code === "string"
    ? (error as NodeJS.ErrnoException).code
    : undefined;
  return new StartupPreflightError({
    phase,
    operation,
    path: targetPath,
    message: cause.message,
    ...(code === undefined ? {} : { code }),
  }, { cause });
}
