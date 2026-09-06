import { existsSync } from "node:fs";
import path from "node:path";
import { bundleLayout, bundledHotkeyHelperPath } from "@svoverlay/desktop-platform/bundle-layout";

import neutralinoConfig from "../../neutralino.config.json" with { type: "json" };
import { createBackendLogger, runBackend } from "./create-backend.ts";
import { terminateAllWindowProcesses } from "../frontend/runtime.ts";
import { NeutralinoShellHost } from "./neutralino-host.ts";
import { claimBackendOwner, readOwner, releaseBackendOwner } from "./backend-owner.ts";
import { findProcessEntry } from "./win32.ts";

const neutralinoRoot = path.resolve(import.meta.dir, "../..");
const backendLog = path.join(neutralinoRoot, bundleLayout.backendLog);
const ownerFile = path.join(neutralinoRoot, bundleLayout.backendOwnerFile);
const logBackend = createBackendLogger(backendLog);

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

await runBackend({
  host: new NeutralinoShellHost(),
  version: neutralinoConfig.version,
  applicationRoot: neutralinoRoot,
  preflightFiles: [path.join(neutralinoRoot, bundleLayout.resourceBundle)],
  portableRoot: existsSync(path.join(neutralinoRoot, bundleLayout.portableMarker)) ? neutralinoRoot : undefined,
  hotkeyHelperPath: path.join(neutralinoRoot, bundledHotkeyHelperPath()),
  backendLogPath: backendLog,
  logPaths: [path.join(neutralinoRoot, bundleLayout.neutralinoLog), backendLog],
  loadDesktopApp: () => import("../../../launcher/src/desktop/desktop.ts"),
});

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
