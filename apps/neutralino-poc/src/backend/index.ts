import path from "node:path";
import { mkdir } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { getNpcapStatus, listNpcapDevices, resolveCaptureDevice } from "@kar-mi/spirit-vale-tools-capture/capture";
import type { LauncherRpc, LauncherState, ToolWindow } from "../../../launcher/src/launcher/types.ts";
import { loadLauncherSettings, saveLauncherSettings } from "../../../launcher/src/launcher/settings.ts";
import { CaptureCoordinator } from "../../../launcher/src/desktop/capture-coordinator.ts";
import { createBossTimerCoordinator } from "../../../launcher/src/desktop/boss-timer-coordinator.ts";
import { createXpTrackerCoordinator } from "../../../launcher/src/desktop/xp-tracker-coordinator.ts";
import { resolveDesktopStoragePaths } from "../../../launcher/src/desktop/portable-paths.ts";
import { configurePortableEnvironment } from "../../../launcher/src/desktop/portable-environment.ts";
import { createOverlayController, type OverlayController, type OverlaySurfaceSink } from "../../../../packages/overlay/src/bun/controller.ts";
import { displayKey } from "@svoverlay/overlay/display-layout";
import { backendConnectionUrl } from "../shared/backend-connection.ts";
import { defineRpc, type RpcInstance } from "../shared/rpc.ts";
import { NeutralinoClient } from "./neutralino-client.ts";
import { attachOverlaySurface } from "./overlay-surface.ts";
import { PocRpcServer, type Session } from "./rpc-server.ts";
import { claimBackendOwner, releaseBackendOwner } from "./backend-owner.ts";

// The extension may inherit an arbitrary working directory when launched from Explorer,
// a terminal, or a child Neutralino process. The bundled file always lives at
// <app>/extensions/backend/index.js (and the source has the same two-level shape).
const neutralinoRoot = path.resolve(import.meta.dir, "../..");
const backendLog = path.join(neutralinoRoot, "neutralino-backend.log");
const ownerFile = path.join(neutralinoRoot, ".neutralino-backend-owner.json");
function logBackend(message: string): void {
  try { appendFileSync(backendLog, `${new Date().toISOString()} ${message}\n`); } catch {}
}
process.on("uncaughtException", (error) => logBackend(`uncaughtException: ${error?.stack ?? error}`));
process.on("unhandledRejection", (error) => logBackend(`unhandledRejection: ${error instanceof Error ? error.stack : String(error)}`));
if (!claimBackendOwner(ownerFile)) {
  logBackend("secondary window extension skipped");
  process.exit(0);
}
logBackend("extension process started");

await configurePortableEnvironment({ executablePath: path.join(neutralinoRoot, "bin", "neutralino-poc.exe") });
process.env.SPIRIT_VALE_HOTKEY_HELPER ??= path.join(neutralinoRoot, "extensions", "bin", "sv-overlay-hotkeys.exe");
const native = await NeutralinoClient.fromStdin();
logBackend("extension socket connected");
native.onClose(() => { void shutdown(false); });
const rpcServer = new PocRpcServer();
const root = process.env.SPIRIT_VALE_PORTABLE_ROOT ?? path.join(neutralinoRoot, ".neutralino-poc-data");
const paths = resolveDesktopStoragePaths({ root, logDirectoryOverride: process.env.SPIRIT_VALE_LOG_DIRECTORY });
await mkdir(paths.logDirectory, { recursive: true });
const settings = await loadLauncherSettings(paths.launcherSettingsPath);
const xp = createXpTrackerCoordinator({ logDirectory: paths.logDirectory });
const bossTimers = await createBossTimerCoordinator({ storagePath: paths.bossTimersPath });

let launcherSession: Session | undefined;
let launcherRpc: RpcInstance<LauncherRpc, "bun"> | undefined;
let overlay: OverlayController;
let overlaySurfacesEnabled = false;
let shuttingDown = false;
const surfaceSessions = new Map<string, Session>();
const surfaceSinks = new Map<string, OverlaySurfaceSink>();
const creatingSurfaces = new Set<string>();
let launcherState: LauncherState = {
  appVersion: "0.9.8-neutralino-poc",
  captureStatus: "starting",
  statusDetail: "Checking Npcap…",
  npcapAvailability: "checking",
  npcapDetail: "Checking Npcap…",
  selectedAdapter: settings.captureAdapter,
  adapterFallback: false,
  adapters: [],
  uiScale: settings.uiScale,
  minimizeToTray: settings.minimizeToTray,
  resetMeterOnMapChange: settings.resetMeterOnMapChange,
  resetGoldOnMapChange: settings.resetGoldOnMapChange,
};

const capture = new CaptureCoordinator({
  logDirectory: paths.logDirectory,
  deviceName: settings.captureAdapter === "auto" ? undefined : settings.captureAdapter,
  onStatus: (state) => { launcherState = { ...launcherState, ...state }; publish(); },
  resetOnMapChange: () => settings.resetMeterOnMapChange,
  onGoldMapChange: () => { if (settings.resetGoldOnMapChange) xp.resetCoins(); },
  minimapEnabled: () => overlay?.settingsState().elements.minimap.enabled ?? true,
  getMinimapRarityFilter: () => overlay?.settingsState().minimapRarityFilter ?? 2,
  getMinimapLootChanceFilter: () => overlay?.settingsState().minimapLootChanceFilter ?? 100,
  onBossGravestone: (event) => bossTimers.recordGravestone(event),
  onServerInstance: (id) => bossTimers.setCurrentInstance(id),
});

overlay = await createOverlayController({
  logDirectory: paths.logDirectory,
  getCharacterState: () => capture.characterState(),
  subscribeCharacter: (listener) => capture.subscribeCharacter(listener),
  subscribeActiveStatuses: (listener) => capture.subscribeActiveStatuses(listener),
  subscribeMinimap: (listener) => capture.subscribeMinimap(listener),
  subscribeLootToast: (listener) => capture.subscribeLootToast(listener),
  xp,
  bossTimers,
  settingsPath: paths.overlaySettingsPath,
  lockOnCreate: true,
  onReset: () => capture.resetSession(),
  onSettingsStateChanged: (state) => {
    launcherState = { ...launcherState, overlayShortcuts: { ...state.shortcuts } };
    publish();
  },
  onSurfacesChanged: () => reconcileSurfaces(),
  isAppProcess: (processId) => launcherSession?.processId === processId
    || [...surfaceSessions.values()].some((session) => session.processId === processId),
});
overlay.start();
logBackend(`backend ready on 127.0.0.1:${rpcServer.port}`);

rpcServer.onSession = (session) => {
  logBackend(`session connected: role=${session.role}${session.display ? ` display=${session.display}` : ""}${session.processId ? ` pid=${session.processId}` : ""}`);
  if (session.role === "launcher") attachLauncher(session);
  else attachSurface(session);
};
rpcServer.onClose = (session) => {
  logBackend(`session closed: role=${session.role}${session.display ? ` display=${session.display}` : ""}`);
  if (session === launcherSession) launcherSession = undefined;
  if (session.role === "overlay" && session.display) {
    overlay.unregisterSurface(session.display);
    surfaceSessions.delete(session.display);
    surfaceSinks.delete(session.display);
    void reconcileSurfaces().catch((error) => logBackend(`surface reconciliation failed: ${error instanceof Error ? error.stack : String(error)}`));
  }
};
rpcServer.onWindowEvent = (session, event) => {
  if (session.role === "launcher" && event === "windowClose") void shutdown();
};

let announceTimer: ReturnType<typeof setInterval> | undefined;
async function announceLauncher(): Promise<void> {
  if (launcherSession || shuttingDown) return;
  const ticket = rpcServer.issue("launcher");
  await native.call("app.broadcast", { event: "neutralinoPocBackendReady", data: { port: rpcServer.port, ticket } });
}
announceTimer = setInterval(() => void announceLauncher().catch(console.error), 750);
await announceLauncher();

native.on("trayMenuItemClicked", (data) => {
  const id = String((data as { id?: string })?.id ?? "");
  if (id === "show-launcher") void launcherSession?.command("show").then(() => launcherSession?.command("focus"));
  else if (id === "toggle-overlay") {
    if (!overlaySurfacesEnabled) {
      overlaySurfacesEnabled = true;
      void reconcileSurfaces().catch((error) => logBackend(`surface reconciliation failed: ${error instanceof Error ? error.stack : String(error)}`));
    } else overlay.setOverlayVisible(!overlay.overlayVisible);
  }
  else if (id === "toggle-lock") overlay.updateLocked(!overlay.locked);
  else if (id === "exit") void shutdown();
});
await native.call("os.setTray", {
  icon: "/resources/views/assets/app-icon.png",
  menuItems: [
    { id: "show-launcher", text: "Main launcher" },
    { id: "toggle-overlay", text: "Show/hide overlay" },
    { id: "toggle-lock", text: "Lock/unlock overlay" },
    { id: "sep", text: "-" },
    { id: "exit", text: "Exit" },
  ],
}).catch((error) => console.warn("[neutralino-poc] tray unavailable:", error));

await refreshCaptureDevices();
if (launcherState.npcapAvailability === "ready") await capture.start();

function attachLauncher(session: Session): void {
  launcherSession = session;
  if (announceTimer) clearInterval(announceTimer);
  announceTimer = undefined;
  launcherRpc = defineRpc<LauncherRpc, "bun">("bun", {
    maxRequestTime: 30_000,
    handlers: { requests: launcherHandlers(), messages: {} },
  });
  launcherRpc.setTransport(session.transport());
  publish();
}

function launcherHandlers() {
  return {
    getState: () => launcherState,
    setCaptureAdapter: async ({ deviceName }: { deviceName: string | null }) => {
      settings.captureAdapter = deviceName ?? "auto";
      await capture.reconfigure(deviceName ?? undefined);
      await saveLauncherSettings(settings, paths.launcherSettingsPath);
      await refreshCaptureDevices();
      return launcherState;
    },
    setUiScale: async ({ uiScale }: { uiScale: LauncherState["uiScale"] }) => {
      settings.uiScale = uiScale; launcherState = { ...launcherState, uiScale }; await persistSettings(); return launcherState;
    },
    setMinimizeToTray: async ({ minimizeToTray }: { minimizeToTray: boolean }) => {
      settings.minimizeToTray = minimizeToTray; launcherState = { ...launcherState, minimizeToTray }; await persistSettings(); return launcherState;
    },
    refreshCaptureDevices: async () => { await refreshCaptureDevices(); if (launcherState.npcapAvailability === "ready") await capture.start(); return launcherState; },
    openNpcapDownload: () => launcherSession?.command("openExternal", { url: "https://npcap.com/#download" }),
    openTool: async ({ tool }: { tool: ToolWindow }) => {
      if (tool === "overlay") {
        overlaySurfacesEnabled = true;
        await reconcileSurfaces();
      }
      else await native.call("os.showMessageBox", { title: "Neutralino POC", content: `${tool} is outside this POC. Capture and the overlay are live.`, choice: "OK", icon: "INFO" });
      return launcherState;
    },
    openSettings: () => native.call("os.showMessageBox", { title: "Neutralino POC", content: "Settings windows are outside this POC.", choice: "OK", icon: "INFO" }),
    manageSettings: () => native.call("os.open", { url: path.dirname(paths.launcherSettingsPath) }),
    openUpdateRelease: () => {}, skipUpdateVersion: () => {}, dismissUpdateNotification: () => {},
    windowAction: async ({ action }: { action: "minimize" | "close" }) => {
      if (action === "minimize") await launcherSession?.command(settings.minimizeToTray ? "hide" : "minimize");
      else await shutdown();
    },
    getWindowFrame: () => launcherSession!.command("getBounds"),
    setWindowFrame: (frame: unknown) => launcherSession!.command("setBounds", frame),
  };
}

async function refreshCaptureDevices(): Promise<void> {
  try {
    const status = await getNpcapStatus();
    if (status.availability !== "ready") {
      launcherState = { ...launcherState, npcapAvailability: status.availability, npcapDetail: status.detail, npcapVersion: status.version, adapters: [], effectiveAdapter: undefined, adapterFallback: false };
    } else {
      const devices = await listNpcapDevices();
      const resolved = await resolveCaptureDevice(devices, settings.captureAdapter === "auto" ? undefined : settings.captureAdapter);
      launcherState = { ...launcherState, npcapAvailability: "ready", npcapDetail: status.detail, npcapVersion: status.version, adapters: devices.map((device) => ({ id: device.name, label: device.description })), selectedAdapter: settings.captureAdapter, effectiveAdapter: resolved.device?.name, adapterFallback: resolved.usedFallback };
    }
  } catch (error) {
    launcherState = { ...launcherState, npcapAvailability: "error", npcapDetail: error instanceof Error ? error.message : String(error), adapters: [], effectiveAdapter: undefined, adapterFallback: false };
  }
  publish();
}

async function reconcileSurfaces(): Promise<void> {
  if (!launcherSession || shuttingDown || !overlaySurfacesEnabled) return;
  const wanted = new Set(overlay.wantedSurfaces());
  for (const [key, session] of surfaceSessions) {
    if (wanted.has(key)) continue;
    void session.command("close");
  }
  for (const display of overlay.displays) {
    const key = displayKey(display);
    if (!wanted.has(key) || surfaceSessions.has(key) || creatingSurfaces.has(key)) continue;
    creatingSurfaces.add(key);
    const ticket = rpcServer.issue("overlay", key);
    try {
      logBackend(`creating overlay surface: display=${key}`);
      const result = await launcherSession.command<unknown>("createWindow", {
        // Neutralino's JS client builds a Windows command string for child windows.
        // A literal '&' in the URL terminates that command before the window flags.
        url: backendConnectionUrl("/views/overlayview/index.html", { port: rpcServer.port, ticket }),
        options: {
          title: "Spirit Vale Overlay",
          x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height,
          borderless: true, transparent: true, hidden: true, alwaysOnTop: true,
          exitProcessOnClose: true, injectGlobals: true, injectClientLibrary: false, useLogicalPixels: false,
          processArgs: "--window-skip-taskbar=true --window-use-saved-state=false",
        },
      });
      const wrapperPid = processId(result);
      logBackend(`overlay child launched: display=${key}${wrapperPid ? ` wrapperPid=${wrapperPid}` : ""}`);
      const timeout = setTimeout(() => {
        if (!creatingSurfaces.delete(key)) return;
        logBackend(`overlay child session timed out: display=${key}`);
        void reconcileSurfaces().catch((error) => logBackend(`surface retry failed: ${error instanceof Error ? error.stack : String(error)}`));
      }, 10_000);
      timeout.unref?.();
    } catch (error) {
      creatingSurfaces.delete(key);
      throw error;
    }
  }
}

function attachSurface(session: Session): void {
  if (!session.display) return;
  creatingSurfaces.delete(session.display);
  surfaceSessions.set(session.display, session);
  if (session.processId !== undefined) activateSurface(session, session.processId);
  else logBackend(`overlay session did not report its native PID: display=${session.display}`);
}

function activateSurface(session: Session, pid: number): void {
  if (!session.display || surfaceSinks.has(session.display)) return;
  const sink = attachOverlaySurface(session, overlay, pid, logBackend);
  surfaceSinks.set(session.display, sink);
}

function processId(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (!value || typeof value !== "object") return undefined;
  const record = value as { pid?: unknown; id?: unknown };
  return typeof record.pid === "number" ? record.pid : typeof record.id === "number" ? record.id : undefined;
}

function publish(): void { try { launcherRpc?.send.stateChanged(launcherState); } catch {} }
async function persistSettings(): Promise<void> { await saveLauncherSettings(settings, paths.launcherSettingsPath); publish(); }

async function shutdown(exitNativeApp = true): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (announceTimer) clearInterval(announceTimer);
  try {
    await capture.stop();
    await overlay.shutdown();
    xp.shutdown();
    await bossTimers.shutdown();
    rpcServer.stop();
    releaseBackendOwner(ownerFile);
  } finally {
    if (exitNativeApp) await native.call("app.exit", { code: 0 }).catch(() => {});
    native.close();
    if (!exitNativeApp) process.exit(0);
  }
}
