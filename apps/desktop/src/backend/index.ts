import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";

import { configurePortableEnvironment } from "../../../launcher/src/desktop/portable-environment.ts";
import { initializeNeutralinoRuntime } from "../frontend/runtime.ts";
import { claimBackendOwner, releaseBackendOwner } from "./backend-owner.ts";
import { findProcessEntry } from "./win32.ts";

const neutralinoRoot = path.resolve(import.meta.dir, "../..");
const backendLog = path.join(neutralinoRoot, "neutralino-backend.log");
const ownerFile = path.join(neutralinoRoot, ".neutralino-backend-owner.json");

function logBackend(message: string): void {
  try { appendFileSync(backendLog, `${new Date().toISOString()} ${message}\n`); } catch {}
}

process.on("uncaughtException", (error) => logBackend(`uncaughtException: ${error?.stack ?? error}`));
process.on("unhandledRejection", (error) => logBackend(`unhandledRejection: ${error instanceof Error ? error.stack : String(error)}`));

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
if (existsSync(path.join(neutralinoRoot, ".spirit-vale-portable"))) {
  await configurePortableEnvironment({ executablePath: path.join(neutralinoRoot, "bin", "SpiritValeOverlay.exe") });
}
process.env.SPIRIT_VALE_HOTKEY_HELPER ??= path.join(neutralinoRoot, "extensions", "bin", "sv-overlay-hotkeys.exe");

await initializeNeutralinoRuntime({ version: "0.10.0" });
logBackend("Neutralino runtime initialized");
await import("../../../launcher/src/desktop/desktop.ts");

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
    process.exit(0);
  }, 2000);
  timer.unref();
}
