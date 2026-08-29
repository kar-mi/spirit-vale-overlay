import { executableBaseNames, platformExecutableName } from "@svoverlay/desktop-platform/executable-names";

interface BootstrapFilesystem {
  getStats(path: string): Promise<{ size: number; isFile: boolean }>;
  readBinaryFile(path: string, options?: { pos: number; size: number }): Promise<ArrayBuffer>;
}

export interface BootstrapRuntimeFailure {
  operation: "bundle-read";
  path: string;
  message: string;
  code?: string;
}

export class BootstrapRuntimeError extends Error {
  constructor(readonly details: BootstrapRuntimeFailure, options?: ErrorOptions) {
    super(details.message, options);
    this.name = "BootstrapRuntimeError";
  }
}

export interface BootstrapPreflightOptions {
  applicationPath: string;
  platform: NodeJS.Platform;
  filesystem: BootstrapFilesystem;
  attempts?: number;
  retryDelayMs?: number;
}

export async function verifyBootstrapFiles(options: BootstrapPreflightOptions): Promise<void> {
  const runtimeName = platformExecutableName(executableBaseNames.bunRuntime, options.platform);
  const files = [
    {
      displayName: `backend runtime ${runtimeName}`,
      path: joinApplicationPath(options.applicationPath, "extensions", "bin", runtimeName),
    },
    {
      displayName: "backend entrypoint index.js",
      path: joinApplicationPath(options.applicationPath, "extensions", "backend", "index.js"),
    },
  ];

  await Promise.all(files.map((file) => verifyBootstrapFile(file, options)));
}

async function verifyBootstrapFile(
  file: { displayName: string; path: string },
  options: BootstrapPreflightOptions,
): Promise<void> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 3));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);

  for (let attempt = 1; ; attempt += 1) {
    try {
      const stats = await options.filesystem.getStats(file.path);
      if (!stats.isFile || stats.size === 0) throw new Error(stats.isFile ? "The file is empty." : "The path is not a file.");
      const sample = await options.filesystem.readBinaryFile(file.path, { pos: 0, size: 1 });
      if (sample.byteLength !== 1) throw new Error("The file could not be read.");
      return;
    } catch (error) {
      if (attempt < attempts) {
        await delay(retryDelayMs * attempt);
        continue;
      }
      const cause = error instanceof Error ? error : new Error(String(error));
      const code = errorCode(error);
      throw new BootstrapRuntimeError({
        operation: "bundle-read",
        path: file.path,
        message: `The required ${file.displayName} is missing, empty, or unreadable. ${cause.message}`,
        ...(code === undefined ? {} : { code }),
      }, { cause });
    }
  }
}

export function neutralinoPlatform(osName: string): NodeJS.Platform {
  if (osName === "Windows") return "win32";
  if (osName === "Darwin") return "darwin";
  return "linux";
}

function joinApplicationPath(root: string, ...parts: string[]): string {
  return [root.replace(/[\\/]+$/, ""), ...parts].join("/");
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
