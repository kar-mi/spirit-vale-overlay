import { existsSync } from "node:fs";
import path from "node:path";
import {
  bundleLayout,
  electronBundleLayout,
  electronBundledHotkeyHelperPath,
} from "@svoverlay/desktop-platform/bundle-layout";
import { createBackendLogger, runBackend } from "@svoverlay/desktop/src/backend/create-backend.ts";
import { ElectronShellHost } from "./electron-host.ts";


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
  // No preflightFiles: Electron ships the plain resources/ directory, not a resources.neu bundle.
  portableRoot,
  hotkeyHelperPath: path.join(root, electronBundledHotkeyHelperPath()),
  backendLogPath: backendLog,
  logPaths: [backendLog],
  loadDesktopApp: () => import("../../../launcher/src/desktop/desktop.ts"),
});
