import { constants } from "node:fs";
import { access, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
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

  // - bundle-read: Could not read a required packaged file, such as resources.neu, bun.exe, or the backend JavaScript.
  // - directory-create: Could not create a required data, settings, logs, or runtime directory.
  // - probe-create: Could not create a temporary test file in a writable directory.
  // - probe-flush: Could not force that test file’s contents to disk.
  // - probe-rename: Could not atomically rename the file—the same behavior used by safe settings saves.
  // - probe-read: Could not reopen and read the renamed file.
  // - probe-verify: The read succeeded, but the contents did not match what was written.
  // - probe-cleanup: Could not remove the temporary test file afterward.

export interface StartupFailureDetails {
  phase: "bundle" | "storage";
  operation: StartupOperation;
  path: string;
  message: string;
  code?: string;
}

export class StartupPreflightError extends Error {
  readonly details: StartupFailureDetails;

  constructor(details: StartupFailureDetails, options?: ErrorOptions) {
    super(details.message, options);
    this.name = "StartupPreflightError";
    this.details = details;
  }
}

export async function verifyReadableFiles(files: readonly string[]): Promise<void> {
  for (const file of files) {
    try {
      const fileStat = await stat(file);
      if (!fileStat.isFile() || fileStat.size === 0) {
        throw new Error(fileStat.isFile() ? "The file is empty." : "The path is not a regular file.");
      }
      await access(file, constants.R_OK);
      const handle = await open(file, "r");
      try {
        const sample = Buffer.alloc(1);
        const result = await handle.read(sample, 0, 1, 0);
        if (result.bytesRead !== 1) throw new Error("The file could not be read.");
      } finally {
        await handle.close();
      }
    } catch (error) {
      throw preflightError("bundle", "bundle-read", file, error);
    }
  }
}

export async function verifyWritableDirectories(directories: readonly string[]): Promise<void> {
  const unique = new Map<string, string>();
  for (const directory of directories) {
    const resolved = path.resolve(directory);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (!unique.has(key)) unique.set(key, resolved);
  }
  for (const resolved of unique.values()) await verifyWritableDirectory(resolved);
}

async function verifyWritableDirectory(directory: string): Promise<void> {
  try {
    await mkdir(directory, { recursive: true });
  } catch (error) {
    throw preflightError("storage", "directory-create", directory, error);
  }

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
      failure ??= preflightError("storage", "probe-cleanup", currentPath, error);
    }
  }
  if (failure) throw failure;
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
