import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";

import { configurePortableEnvironment } from "../../../launcher/src/desktop/portable-environment.ts";
import { initializeNeutralinoRuntime } from "../frontend/runtime.ts";
import { claimBackendOwner, releaseBackendOwner } from "./backend-owner.ts";

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
if (existsSync(path.join(neutralinoRoot, ".spirit-vale-portable"))) {
  await configurePortableEnvironment({ executablePath: path.join(neutralinoRoot, "bin", "SpiritValeOverlay.exe") });
}
process.env.SPIRIT_VALE_HOTKEY_HELPER ??= path.join(neutralinoRoot, "extensions", "bin", "sv-overlay-hotkeys.exe");

await initializeNeutralinoRuntime({ version: "0.9.8" });
logBackend("Neutralino runtime initialized");
await import("../../../launcher/src/desktop/desktop.ts");
