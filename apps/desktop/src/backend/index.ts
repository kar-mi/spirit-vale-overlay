import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";
import { StartupPreflightError, verifyReadableFiles } from "@svoverlay/desktop-platform/startup-preflight";
import { bundleLayout, bundledHotkeyHelperPath } from "@svoverlay/desktop-platform/bundle-layout";

import neutralinoConfig from "../../neutralino.config.json" with { type: "json" };
import { configurePortableEnvironment } from "../../../launcher/src/desktop/portable-environment.ts";
import { initializeNeutralinoRuntime, markDesktopBackendReady, reportStartupFailure, terminateAllWindowProcesses } from "../frontend/runtime.ts";
import type { StartupFailure } from "../shared/protocol.ts";
import { claimBackendOwner, readOwner, releaseBackendOwner } from "./backend-owner.ts";
import { findProcessEntry } from "./win32.ts";

const neutralinoRoot = path.resolve(import.meta.dir, "../..");
const backendLog = path.join(neutralinoRoot, bundleLayout.backendLog);
const ownerFile = path.join(neutralinoRoot, bundleLayout.backendOwnerFile);

function logBackend(message: string): void {
  try { appendFileSync(backendLog, `${new Date().toISOString()} ${message}\n`); } catch {}
}

function formatLogArg(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

// Neutralino does not persist an extension's stdout/stderr, so mirror error/warn output
// into backend.log — otherwise a non-fatal runtime fault leaves no trace.
for (const level of ["error", "warn"] as const) {
  const write = console[level].bind(console);
  console[level] = (...args: unknown[]): void => {
    write(...args);
    logBackend(`console.${level}: ${args.map(formatLogArg).join(" ")}`);
  };
}

process.on("uncaughtException", (error) => logBackend(`uncaughtException: ${error?.stack ?? error}`));
process.on("unhandledRejection", (error) => logBackend(`unhandledRejection: ${error instanceof Error ? error.stack : String(error)}`));

// A previous session that closed and reopened faster than its old backend's own
// orphan watchdog could notice would otherwise still look like a live owner here,
// so a fresh instance would defer to a zombie that is about to disappear, leaving
// this session without a backend. Clear that out before claiming ownership.
terminateStaleOwner(ownerFile);

// Neutralino launches the configured extension for every child window. Only the
// first process may consume the parent application's extension socket.
if (!claimBackendOwner(ownerFile)) {
  logBackend("secondary window extension skipped");
  process.exit(0);
}

const releaseOwner = () => releaseBackendOwner(ownerFile);
process.on("exit", releaseOwner);
process.on("SIGINT", releaseOwner);
process.on("SIGTERM", releaseOwner);

logBackend("desktop extension process started");
watchOwningProcess();
await startBackend();

async function startBackend(): Promise<void> {
  let runtimeReady = false;
  let phase = "bundle preflight";
  try {
    await verifyReadableFiles([
      path.join(neutralinoRoot, bundleLayout.resourceBundle),
    ], {
      onRetry: (failure, attempt, attempts) => logBackend(
        `startup preflight retry ${attempt + 1}/${attempts} (${failure.operation}, ${failure.code ?? "no code"}): ${failure.path}: ${failure.message}`,
      ),
    });
    logBackend("resource bundle preflight passed");

    phase = "portable environment";
    if (existsSync(path.join(neutralinoRoot, bundleLayout.portableMarker))) {
      // The marker check above already established the root, and this process runs from
      // the bundled Bun under extensions/bin, which executable-based discovery would
      // resolve to the wrong directory.
      await configurePortableEnvironment({ portableRoot: neutralinoRoot });
    } else {
      process.env.SPIRIT_VALE_PACKAGED = "1";
    }
    process.env.SPIRIT_VALE_HOTKEY_HELPER ??= path.join(neutralinoRoot, bundledHotkeyHelperPath());

    phase = "Neutralino runtime";
    await initializeNeutralinoRuntime({ version: neutralinoConfig.version });
    runtimeReady = true;
    logBackend("Neutralino runtime initialized");

    phase = "desktop initialization";
    await import("../../../launcher/src/desktop/desktop.ts");
    await markDesktopBackendReady();
    logBackend("desktop application initialized");
  } catch (error) {
    const failure = startupFailure(error, phase);
    logBackend(`startup failure (${failure.phase}/${failure.operation}): ${errorStack(error)}`);
    terminateAllWindowProcesses({ preserveLauncher: true });
    if (runtimeReady) await reportStartupFailure(failure).catch((reportError) => {
      logBackend(`could not publish startup failure: ${errorStack(reportError)}`);
    });
    setTimeout(() => process.exit(1), runtimeReady ? 500 : 0);
  }
}

function startupFailure(error: unknown, phase: string): StartupFailure {
  const logPaths = [path.join(neutralinoRoot, bundleLayout.neutralinoLog), backendLog];
  if (error instanceof StartupPreflightError) {
    const { phase: category, ...details } = error.details;
    return {
      ...details,
      phase,
      category,
      applicationPath: neutralinoRoot,
      logPaths,
    };
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
    applicationPath: neutralinoRoot,
    logPaths,
  };
}

function errorStack(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

// An owner PID can still be alive yet orphaned: its own app process (found by
// walking up past the `cmd.exe` hop the same way watchOwningProcess does) is
// already gone. That bun is dead weight that will exit on its own within a
// couple of seconds anyway; terminate it immediately so this instance does not
// have to wait for it, and so claimBackendOwner does not defer to it.
function terminateStaleOwner(file: string): void {
  if (process.platform !== "win32") return;
  const owner = readOwner(file);
  if (owner === undefined) return;
  const bunEntry = findProcessEntry(owner);
  if (!bunEntry) return;
  const cmdEntry = findProcessEntry(bunEntry.parentProcessId);
  if (!cmdEntry) return;
  if (findProcessEntry(cmdEntry.parentProcessId)) return;
  logBackend(`stale backend owner ${owner} (${bunEntry.exeFile}) has no live app process; terminating`);
  try { process.kill(owner); } catch {}
}

// Neutralino launches `commandWindows` via `cmd.exe /c "..."` on Windows, so this
// process's OS parent is that intermediate cmd.exe, not the owning Neutralino
// process. cmd.exe does not exit when its own parent dies, which defeats Bun's
// `--no-orphans` parent-death detection if the app is force-closed or crashes.
// Resolve the real owning process once and poll its liveness as a fallback,
// re-checking its image name each time in case Windows recycles the PID onto an
// unrelated process before we notice the original one is gone.
function watchOwningProcess(): void {
  if (process.platform !== "win32") return;
  const cmdEntry = findProcessEntry(process.ppid);
  if (!cmdEntry) return;
  const owningProcessId = cmdEntry.parentProcessId;
  const owningExeFile = findProcessEntry(owningProcessId)?.exeFile;
  if (!owningExeFile) return;
  const timer = setInterval(() => {
    if (findProcessEntry(owningProcessId)?.exeFile === owningExeFile) return;
    logBackend(`owning process ${owningProcessId} (${owningExeFile}) is gone; exiting`);
    terminateAllWindowProcesses();
    process.exit(0);
  }, 2000);
  timer.unref();
}
