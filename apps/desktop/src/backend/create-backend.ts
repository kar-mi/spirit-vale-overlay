import { appendFileSync } from "node:fs";
import { StartupPreflightError, verifyReadableFiles } from "@svoverlay/desktop-platform/startup-preflight";
import { configurePortableEnvironment } from "../../../launcher/src/desktop/portable-environment.ts";
import {
  initializeDesktopRuntime,
  markDesktopBackendReady,
  reportStartupFailure,
  terminateAllWindowProcesses,
} from "../frontend/runtime.ts";
import type { StartupFailure } from "../shared/protocol.ts";
import type { ShellHost } from "./shell-host.ts";

export interface BackendEntryConfig {
  host: ShellHost;
  version: string;
  /** Application root, reported in the startup-failure card. */
  applicationRoot: string;
  /** Files whose readability is verified before anything else (Neutralino's resources.neu). */
  preflightFiles?: string[];
  /** Portable data root, or undefined when running as a normal installed app. */
  portableRoot?: string;
  /** Absolute path to the bundled pass-through hotkey helper. */
  hotkeyHelperPath: string;
  /** backend.log path for mirrored console output. */
  backendLogPath: string;
  /** Log files worth pointing the user at when startup fails. */
  logPaths: string[];
  /** Imports the launcher's `desktop.ts` once the runtime is ready. */
  loadDesktopApp: () => Promise<unknown>;
}

export function createBackendLogger(backendLogPath: string): (message: string) => void {
  return (message: string) => {
    try { appendFileSync(backendLogPath, `${new Date().toISOString()} ${message}\n`); } catch {}
  };
}

function formatLogArg(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function errorStack(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

export async function runBackend(config: BackendEntryConfig): Promise<void> {
  const logBackend = createBackendLogger(config.backendLogPath);

  // Neither shell persists an extension's stdout/stderr reliably, so mirror
  // error/warn output into backend.log — otherwise a non-fatal fault leaves no trace.
  for (const level of ["error", "warn"] as const) {
    const write = console[level].bind(console);
    console[level] = (...args: unknown[]): void => {
      write(...args);
      logBackend(`console.${level}: ${args.map(formatLogArg).join(" ")}`);
    };
  }
  process.on("uncaughtException", (error) => logBackend(`uncaughtException: ${error?.stack ?? error}`));
  process.on("unhandledRejection", (error) => logBackend(`unhandledRejection: ${error instanceof Error ? error.stack : String(error)}`));

  let runtimeReady = false;
  let phase = "bundle preflight";
  try {
    if (config.preflightFiles?.length) {
      await verifyReadableFiles(config.preflightFiles, {
        onRetry: (failure, attempt, attempts) => logBackend(
          `startup preflight retry ${attempt + 1}/${attempts} (${failure.operation}, ${failure.code ?? "no code"}): ${failure.path}: ${failure.message}`,
        ),
      });
      logBackend("resource bundle preflight passed");
    }

    phase = "portable environment";
    if (config.portableRoot !== undefined) {
      await configurePortableEnvironment({ portableRoot: config.portableRoot });
    } else {
      process.env.SPIRIT_VALE_PACKAGED = "1";
    }
    process.env.SPIRIT_VALE_HOTKEY_HELPER ??= config.hotkeyHelperPath;

    phase = "desktop runtime";
    await initializeDesktopRuntime(config.host, { version: config.version });
    runtimeReady = true;
    logBackend(`${config.host.kind} runtime initialized`);

    phase = "desktop initialization";
    await config.loadDesktopApp();
    await markDesktopBackendReady();
    logBackend("desktop application initialized");
  } catch (error) {
    const failure = startupFailure(error, phase, config);
    logBackend(`startup failure (${failure.phase}/${failure.operation}): ${errorStack(error)}`);
    terminateAllWindowProcesses({ preserveLauncher: true });
    if (runtimeReady) await reportStartupFailure(failure).catch((reportError) => {
      logBackend(`could not publish startup failure: ${errorStack(reportError)}`);
    });
    setTimeout(() => process.exit(1), runtimeReady ? 500 : 0);
  }
}

function startupFailure(error: unknown, phase: string, config: BackendEntryConfig): StartupFailure {
  if (error instanceof StartupPreflightError) {
    const { phase: category, ...details } = error.details;
    return { ...details, phase, category, applicationPath: config.applicationRoot, logPaths: config.logPaths };
  }
  const cause = error instanceof Error ? error : new Error(String(error));
  const code = typeof (error as NodeJS.ErrnoException | undefined)?.code === "string"
    ? (error as NodeJS.ErrnoException).code
    : undefined;
  return {
    phase,
    operation: "initialize",
    message: cause.message,
    ...(code === undefined ? {} : { code }),
    applicationPath: config.applicationRoot,
    logPaths: config.logPaths,
  };
}
