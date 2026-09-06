import { existsSync } from "node:fs";
import path from "node:path";
import {
  bundleLayout,
  electronBundleLayout,
  electronBundledHotkeyHelperPath,
} from "@svoverlay/desktop-platform/bundle-layout";
import { createBackendLogger, runBackend } from "@svoverlay/desktop/src/backend/create-backend.ts";
import { ElectronShellHost } from "./electron-host.ts";

// The Bun backend for the Electron build. Electron main spawns this exact process
// (same bundled bun.exe, same index.js contract) and owns its lifetime, so there
// is no owner file and no cmd.exe-hop watchdog — a dead control socket is the
// single liveness signal, handled by ElectronShellHost.onOwnerGone.

// Main passes the bundle root explicitly: with electron-builder extraResources the
// backend runs from resources/extensions/backend, and executable-based discovery
// would resolve the portable root to the wrong directory (see electron.md §Packaging).
const root = process.env["SPIRIT_VALE_ROOT"] ?? path.resolve(import.meta.dir, "../../..");
const backendLog = path.join(root, electronBundleLayout.backendLog);
const logBackend = createBackendLogger(backendLog);

const version = process.env["SPIRIT_VALE_VERSION"] ?? "0.0.0";
const portableRoot = existsSync(path.join(root, bundleLayout.portableMarker)) ? root : undefined;

logBackend(`electron backend process started (portable: ${portableRoot !== undefined})`);

await runBackend({
  host: new ElectronShellHost(),
  version,
  applicationRoot: root,
  // Electron ships the plain resources/ directory, not resources.neu, so there is
  // no single bundle file to preflight.
  portableRoot,
  hotkeyHelperPath: path.join(root, electronBundledHotkeyHelperPath()),
  backendLogPath: backendLog,
  logPaths: [backendLog],
  loadDesktopApp: () => import("../../../launcher/src/desktop/desktop.ts"),
});
