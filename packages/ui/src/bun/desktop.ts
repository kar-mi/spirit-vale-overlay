import Electrobun, { BrowserView, BrowserWindow, Tray, Utils } from "electrobun/bun";
import { applyRoundedCorners, makeProcessDpiAware, setWindowIcon } from "@spiritvale/ui-core/win32";
import { appIconPath } from "@spiritvale/ui-core/window-publish";
import { getNpcapStatus, listNpcapDevices, resolveCaptureDevice } from "@kar-mi/spirit-vale-tools-capture/capture";

import { createMarketWindow } from "@spiritvale/market-ui";
import { createBuildExportWindow } from "@spiritvale/build-export";
import { createRewardsWindow } from "@spiritvale/rewards-ui";
import type { LauncherRpc, LauncherSettingsRpc, LauncherState, ToolWindow } from "../launcher-types.ts";
import { loadLauncherSettings, saveLauncherSettings } from "../launcher-settings.ts";
import {
  activeCharacterSnapshot,
  loadCharacterCache,
  saveCharacterCache,
  updateCharacterCache,
  type CharacterSnapshotCache,
} from "../character-storage.ts";
import {
  loadActorIdentityCache,
  saveActorIdentityCache,
  updateActorIdentityCache,
  type ActorIdentityCache,
} from "../actor-identity-storage.ts";
import { CaptureCoordinator } from "./capture-coordinator.ts";
import { createXpTrackerCoordinator } from "./xp-tracker-coordinator.ts";
import { createReadModelService } from "./read-model-service.ts";
import { measureLogStorage } from "./log-storage.ts";
import { createCharacterWindow } from "./character-window.ts";
import { createDeathLogWindow, createDpsWindow } from "@spiritvale/combat-ui";
import { createOverlayWindow } from "@spiritvale/overlay";
import { KEYBIND_ACTIONS, type KeybindAction } from "@spiritvale/overlay/app-types";
import { isWorkspaceDevelopmentRoot } from "@spiritvale/ui-core/local-storage";
import { resolveLocalRoot } from "./paths.ts";
import { SafeSaveQueue } from "@spiritvale/ui-core/safe-save";
import { WindowSlot } from "./window-slot.ts";
import { resolveDesktopStoragePaths } from "./portable-paths.ts";
import type { WindowFrame } from "@spiritvale/ui-core/window-chrome";
import { registerUiScaleWindow, scaledSize, setUiScale } from "@spiritvale/ui-core/ui-scale-window";
import { WindowPlacementStore } from "@spiritvale/ui-core/window-placement";
import { launcherMinimizeAction, trayAction } from "./launcher-tray-actions.ts";
import { findAvailableUpdate } from "../update-check.ts";
import { DisposableStore, onWindowEvent, onceWindowEvent } from "@spiritvale/ui-core/window-lifecycle";
import { HumanReadableErrorLog } from "./human-readable-error-log.ts";

makeProcessDpiAware();

const localRoot = resolveLocalRoot();
const appVersion = (await Electrobun.Updater.getLocalInfo()).version;
const storagePaths = resolveDesktopStoragePaths({
  root: localRoot,
  workspaceDev: isWorkspaceDevelopmentRoot(localRoot),
  portable: Boolean(process.env.SPIRIT_VALE_PORTABLE_ROOT?.trim()),
  logDirectoryOverride: process.env.SPIRIT_VALE_LOG_DIRECTORY,
});
const logDirectory = storagePaths.logDirectory;
const errorLog = new HumanReadableErrorLog(localRoot);
// One read model for the whole process: a disposable SQLite cache over the canonical JSON Lines
// logs, so tool windows can page history from disk instead of each rebuilding it in memory.
const readModel = await createReadModelService({ logDirectory });
const xpTracker = createXpTrackerCoordinator({ logDirectory });
const settings = await loadLauncherSettings(storagePaths.launcherSettingsPath);
setUiScale(settings.uiScale);
let placementStorageWarning: string | undefined;
const placements = await WindowPlacementStore.load(storagePaths.windowPlacementsPath, {
  onWarning: (warning) => { placementStorageWarning = warning; updateStorageWarning(); },
});
let launcherWindow: BrowserWindow;
let settingsWindow: BrowserWindow | undefined;
let settingsLifecycle: DisposableStore | undefined;
const launcherLifecycle = new DisposableStore();
let launcherState: LauncherState = {
  appVersion,
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
};
let shuttingDown = false;
let characterStorageWarning: string | undefined;
let launcherSettingsStorageWarning: string | undefined;
let actorIdentityStorageWarning: string | undefined;
let liveCombatLogPath: string | undefined;

const liveDeathLogWindow = createDeathLogWindow({
  logDirectory,
  readModel,
  placements,
  placementKey: "live-combat-death-log",
  defaultFrame: { x: 220, y: 180, width: 850, height: 680 },
  onOpenSettings: openSettings,
});

const launcherSettingsPersistence = new SafeSaveQueue<typeof settings>({
  label: "launcher settings",
  save: (value) => saveLauncherSettings(value, storagePaths.launcherSettingsPath),
  onWarning: (warning) => { launcherSettingsStorageWarning = warning; updateStorageWarning(); },
});
let characterCache: CharacterSnapshotCache = { characters: [] };
const characterPersistence = new SafeSaveQueue<CharacterSnapshotCache>({
  label: "character snapshot",
  // `updateCharacterCache` returns a fresh cache that nothing mutates afterwards, so the queue does
  // not need its own copy.
  clone: false,
  save: (value) => saveCharacterCache(value, storagePaths.characterStatePath),
  onWarning: (warning) => { characterStorageWarning = warning; updateStorageWarning(); },
});
let actorIdentityCache: ActorIdentityCache = await loadActorIdentityCache(storagePaths.actorIdentitiesPath);
const actorIdentityPersistence = new SafeSaveQueue<ActorIdentityCache>({
  label: "actor identities",
  // Likewise fresh per update, and this one is scheduled in bursts over a map of up to 15,000
  // entries, so copying it per call is exactly the cost worth avoiding.
  clone: false,
  save: (value) => saveActorIdentityCache(value, storagePaths.actorIdentitiesPath),
  onWarning: (warning) => { actorIdentityStorageWarning = warning; updateStorageWarning(); },
});

const combatWindow = new WindowSlot((onClosed) => createDpsWindow({
  logDirectory,
  readModel,
  getCharacterState: () => capture.characterState(),
  subscribeCharacter: (listener) => capture.subscribeCharacter(listener),
  settingsPath: storagePaths.dpsSettingsPath,
  placements,
  onClosed,
  onReset: () => capture.resetSession(),
  onOpenSettings: openSettings,
  onOpenLiveDeathLog: openLiveDeathLog,
}));
const overlayWindow = new WindowSlot((onClosed) => createOverlayWindow({
  logDirectory,
  getCharacterState: () => capture.characterState(),
  subscribeCharacter: (listener) => capture.subscribeCharacter(listener),
  xp: xpTracker,
  settingsPath: storagePaths.overlaySettingsPath,
  // No `placements` here: each overlay surface is pinned to a whole display, so there is no
  // user-moved frame to remember.
  lockOnCreate: true,
  onReset: () => capture.resetSession(),
  onOpenLiveDeathLog: openLiveDeathLog,
  onLiveLogPathChanged: (nextPath) => {
    liveCombatLogPath = nextPath;
    if (nextPath) void liveDeathLogWindow.refresh(nextPath);
  },
  onSettingsStateChanged: (overlayState) => {
    rememberOverlayShortcuts(overlayState.shortcuts);
    void publishSettings(overlayState);
  },
  onClosed,
}));
const rewardsWindow = new WindowSlot((onClosed) => createRewardsWindow({
  logDirectory,
  readModel,
  xp: xpTracker,
  getCharacterState: () => capture.characterState(),
  subscribeCharacter: (listener) => capture.subscribeCharacter(listener),
  settingsPath: storagePaths.rewardsSettingsPath,
  placements,
  onClosed,
  onReset: () => capture.resetSession(),
  onOpenSettings: openSettings,
}));
const marketWindow = new WindowSlot((onClosed) => createMarketWindow({ logDirectory, placements, onClosed, onOpenSettings: openSettings }));

const capture = new CaptureCoordinator({
  logDirectory,
  deviceName: settings.captureAdapter === "auto" ? undefined : settings.captureAdapter,
  onStatus: (state) => {
    launcherState = { ...launcherState, ...state };
    publish();
  },
  onError: (report) => errorLog.write(report),
  resetOnMapChange: () => settings.resetMeterOnMapChange,
  knownIdentities: [...actorIdentityCache.entries.values()],
  onIdentityLearned: (identity) => {
    actorIdentityCache = updateActorIdentityCache(actorIdentityCache, { ...identity, lastSeenAtMs: Date.now() });
    actorIdentityPersistence.schedule(actorIdentityCache);
  },
});
characterCache = await loadCharacterCache(storagePaths.characterStatePath);
capture.setCachedCharacter(activeCharacterSnapshot(characterCache));
const unsubscribeCharacterPersistence = capture.subscribeCharacter((state) => {
  if (!state.snapshot || state.snapshot.source !== "live") return;
  characterCache = updateCharacterCache(characterCache, state.snapshot);
  characterPersistence.schedule(characterCache);
});
const characterWindow = new WindowSlot((onClosed) => createCharacterWindow({
  getState: () => capture.characterState(),
  subscribe: (listener) => capture.subscribeCharacter(listener),
  placements,
  onClosed,
  onOpenSettings: openSettings,
}));
const buildExportWindow = new WindowSlot((onClosed) => createBuildExportWindow({
  getCharacter: () => capture.characterState().snapshot,
  subscribeCharacter: (listener) => capture.subscribeCharacter(listener),
  getInspected: () => capture.inspectedCharacters(),
  subscribeInspected: (listener) => capture.subscribeInspectedCharacters(() => listener()),
  placements,
  onClosed,
  onOpenSettings: openSettings,
}));

function sharedLauncherHandlers(getWindow: () => BrowserWindow | undefined, fallbackFrame: WindowFrame) {
  return {
    getState: () => launcherState,
    setCaptureAdapter: ({ deviceName }: { deviceName: string | null }) => setCaptureAdapter(deviceName),
    setUiScale: ({ uiScale }: { uiScale: typeof settings.uiScale }) => setLauncherUiScale(uiScale),
    setMinimizeToTray: ({ minimizeToTray }: { minimizeToTray: boolean }) => setMinimizeToTray(minimizeToTray),
    refreshCaptureDevices: async () => {
      await refreshCaptureDevices();
      if (launcherState.npcapAvailability === "ready" && capture.state().captureStatus !== "capturing") {
        await capture.start();
      }
      return launcherState;
    },
    openNpcapDownload: () => { Utils.openExternal("https://npcap.com/#download"); },
    getWindowFrame: () => getWindow()?.getFrame() ?? fallbackFrame,
    setWindowFrame: ({ x, y, width, height }: WindowFrame) => { getWindow()?.setFrame(x, y, width, height); },
  };
}

const rpc = BrowserView.defineRPC<LauncherRpc>({
  maxRequestTime: 30_000,
  handlers: {
    requests: {
      ...sharedLauncherHandlers(() => launcherWindow, { x: 80, y: 80, width: 1200, height: 538 }),
      openTool: async ({ tool }) => {
        await openTool(tool);
        return launcherState;
      },
      openSettings: () => { openSettings(); },
      openUpdateRelease: () => { if (launcherState.update) Utils.openExternal(launcherState.update.url); },
      skipUpdateVersion: async () => {
        if (!launcherState.update) return;
        settings.skippedUpdateVersion = launcherState.update.version;
        await launcherSettingsPersistence.flush(settings);
        launcherState = { ...launcherState, update: undefined };
        publish();
      },
      dismissUpdateNotification: () => {
        if (!launcherState.update) return;
        launcherState = { ...launcherState, update: undefined };
        publish();
      },
      windowAction: async ({ action }) => {
        if (action === "minimize") minimizeLauncher();
        else await closeLauncher();
      },
    },
    messages: {},
  },
});

const settingsRpc = BrowserView.defineRPC<LauncherSettingsRpc>({
  maxRequestTime: 30_000,
  handlers: {
    requests: {
      getState: () => sharedSettingsState(),
      setCaptureAdapter: async ({ deviceName }) => {
        await setCaptureAdapter(deviceName);
        return sharedSettingsState();
      },
      setUiScale: async ({ uiScale }) => {
        await setLauncherUiScale(uiScale);
        return sharedSettingsState();
      },
      setMinimizeToTray: async ({ minimizeToTray }) => {
        setMinimizeToTray(minimizeToTray);
        return sharedSettingsState();
      },
      setResetMeterOnMapChange: async ({ resetMeterOnMapChange }) => {
        setResetMeterOnMapChange(resetMeterOnMapChange);
        return sharedSettingsState();
      },
      refreshCaptureDevices: async () => {
        await refreshCaptureDevices();
        if (launcherState.npcapAvailability === "ready" && capture.state().captureStatus !== "capturing") await capture.start();
        return sharedSettingsState();
      },
      openNpcapDownload: () => { Utils.openExternal("https://npcap.com/#download"); },
      setOverlayLocked: async ({ locked }) => {
        await overlayWindow.withWindow((overlay) => overlay.setLocked(locked));
        return sharedSettingsState();
      },
      setOverlayElementEnabled: async ({ id, enabled }) => {
        await overlayWindow.withWindow((overlay) => overlay.setElementEnabled(id, enabled));
        return sharedSettingsState();
      },
      setOverlayElementDisplay: async ({ id, display }) => {
        await overlayWindow.withWindow((overlay) => overlay.setElementDisplay(id, display));
        return sharedSettingsState();
      },
      setOverlayHomeDisplay: async ({ display }) => {
        await overlayWindow.withWindow((overlay) => overlay.setHomeDisplay(display));
        return sharedSettingsState();
      },
      setOverlayVisible: async ({ visible }) => {
        await overlayWindow.withWindow((overlay) => overlay.setOverlayVisible(visible));
        return sharedSettingsState();
      },
      setShortcut: async ({ action, shortcut }) => {
        await overlayWindow.withWindow((overlay) => overlay.setShortcut(action, shortcut));
        return sharedSettingsState();
      },
      setShortcutCapture: async ({ active }) => {
        await overlayWindow.withWindow((overlay) => overlay.setShortcutCapture(active));
        return sharedSettingsState();
      },
      setOverlayRequiredStatuses: async ({ category, statusIds }) => {
        await overlayWindow.withWindow((overlay) => overlay.setRequiredStatuses(category, statusIds));
        return sharedSettingsState();
      },
      windowAction: ({ action }) => {
        if (action === "minimize") settingsWindow?.minimize();
        else settingsWindow?.close();
      },
      getWindowFrame: () => settingsWindow?.getFrame() ?? { x: 110, y: 110, width: 798, height: 680 },
      setWindowFrame: ({ x, y, width, height }) => { settingsWindow?.setFrame(x, y, width, height); },
    },
    messages: {},
  },
});

launcherWindow = new BrowserWindow({
  title: "Spirit Vale Overlay",
  url: "views://launcherview/index.html",
  frame: placements.frame("launcher", { x: 80, y: 80, width: 1200, height: 538 }, { width: 900, height: 430 }),
  titleBarStyle: "hidden",
  transparent: false,
  rpc,
});
applyRoundedCorners(launcherWindow.ptr);
setWindowIcon(launcherWindow.ptr, appIconPath);
launcherLifecycle.add(registerUiScaleWindow(launcherWindow, { scaleInitialFrame: false }));
launcherLifecycle.add(placements.track("launcher", launcherWindow));

const tray = new Tray({
  title: "Spirit Vale Overlay",
  image: "views://assets/app-icon.ico",
  width: 32,
  height: 32,
});
tray.setMenu([
  { type: "normal", label: "Main launcher", action: "show-launcher" },
  { type: "normal", label: "Combat", action: "open-combat" },
  { type: "normal", label: "Overlay", action: "open-overlay" },
  { type: "normal", label: "Rewards", action: "open-rewards" },
  { type: "divider" },
  { type: "normal", label: "Exit", action: "exit" },
]);
tray.on("tray-clicked", (event) => {
  const action = trayAction((event as { data: { action: string } }).data.action);
  if (action === "show-launcher") showLauncher();
  else if (action === "open-combat") void openTool("combat");
  else if (action === "open-overlay") void openTool("overlay");
  else if (action === "open-rewards") void openTool("rewards");
  else if (action === "exit") void shutdown();
});

launcherLifecycle.add(onWindowEvent(launcherWindow, "resize", (event: { data: { width: number; height: number } }) => {
  const width = Math.max(scaledSize(900), event.data.width);
  const height = Math.max(scaledSize(430), event.data.height);
  if (width !== event.data.width || height !== event.data.height) launcherWindow.setSize(width, height);
}));
launcherLifecycle.add(onceWindowEvent(launcherWindow, "close", () => void shutdown()));

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
void initializeCapture();
void checkForUpdate();
void measureLogUsage();
void overlayWindow.open().catch((error) => {
  console.error(`[overlay] startup failed: ${error instanceof Error ? error.message : String(error)}`);
});

/**
 * Totals the log directory once at launch, for the launcher's storage line.
 *
 * Measured once rather than polled: nothing prunes these logs so the figure only grows, and the
 * launcher shows when it was taken. Off the startup path because it walks the tree, though on a
 * ~950MB directory that is milliseconds.
 */
async function measureLogUsage(): Promise<void> {
  const usage = await measureLogStorage(logDirectory);
  if (!usage) return;
  launcherState = { ...launcherState, logStorage: usage };
  publish();
}

async function checkForUpdate(): Promise<void> {
  try {
    const update = await findAvailableUpdate(appVersion);
    if (!update || update.version === settings.skippedUpdateVersion) return;
    launcherState = { ...launcherState, update };
    publish();
    Utils.showNotification({
      title: "Spirit Vale Overlay update available",
      body: `Version ${update.version} is ready to download.`,
    });
  } catch {
    // Update checks are opportunistic: offline use must remain uninterrupted.
  }
}

async function initializeCapture(): Promise<void> {
  await refreshCaptureDevices();
  if (launcherState.npcapAvailability !== "ready") {
    errorLog.write({
      title: "Capture could not start",
      reason: launcherState.npcapDetail,
      details: { "Npcap status": launcherState.npcapAvailability },
    });
    launcherState = { ...launcherState, captureStatus: "unavailable", statusDetail: launcherState.npcapDetail };
    publish();
    return;
  }
  await capture.start();
}

async function refreshCaptureDevices(): Promise<void> {
  try {
    const status = await getNpcapStatus();
    if (status.availability !== "ready") {
      launcherState = {
        ...launcherState,
        npcapAvailability: status.availability,
        npcapDetail: status.detail,
        ...(status.version ? { npcapVersion: status.version } : {}),
        adapters: [],
        effectiveAdapter: undefined,
        adapterFallback: false,
      };
      publish();
      return;
    }
    const devices = await listNpcapDevices();
    const requested = settings.captureAdapter === "auto" ? undefined : settings.captureAdapter;
    const resolved = await resolveCaptureDevice(devices, requested);
    launcherState = {
      ...launcherState,
      npcapAvailability: "ready",
      npcapDetail: status.detail,
      ...(status.version ? { npcapVersion: status.version } : {}),
      selectedAdapter: settings.captureAdapter,
      effectiveAdapter: resolved.device?.name,
      adapterFallback: resolved.usedFallback,
      adapters: devices.map((device) => ({ id: device.name, label: device.description })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorLog.write({ title: "Network adapters could not be inspected", reason: message });
    launcherState = {
      ...launcherState,
      npcapAvailability: "error",
      npcapDetail: message,
      adapters: [],
      effectiveAdapter: undefined,
      adapterFallback: false,
    };
  }
  publish();
}

async function openTool(tool: ToolWindow): Promise<void> {
  if (tool === "combat") await combatWindow.open();
  else if (tool === "overlay") await overlayWindow.open();
  else if (tool === "rewards") await rewardsWindow.open();
  else if (tool === "market") await marketWindow.open();
  else if (tool === "build-export") await buildExportWindow.open();
  else await characterWindow.open();
}

async function openLiveDeathLog(): Promise<void> {
  if (!liveCombatLogPath) return;
  await liveDeathLogWindow.open(liveCombatLogPath, true);
}

function openSettings(): void {
  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.activate();
    return;
  }
  const nextWindow = new BrowserWindow({
    title: "Spirit Vale Overlay Settings",
    url: "views://settingsview/index.html",
    frame: placements.frame(
      "launcher-settings",
      { x: 110, y: 110, width: 798, height: 680 },
      { width: 560, height: 420 },
    ),
    titleBarStyle: "hidden",
    transparent: false,
    rpc: settingsRpc,
  });
  const lifecycle = new DisposableStore();
  settingsWindow = nextWindow;
  settingsLifecycle = lifecycle;
  applyRoundedCorners(nextWindow.ptr);
  setWindowIcon(nextWindow.ptr, appIconPath);
  lifecycle.add(registerUiScaleWindow(nextWindow, { scaleInitialFrame: false }));
  lifecycle.add(placements.track("launcher-settings", nextWindow));
  lifecycle.add(onWindowEvent(nextWindow, "resize", (event: { data: { width: number; height: number } }) => {
    const width = Math.max(scaledSize(560), event.data.width);
    const height = Math.max(scaledSize(420), event.data.height);
    if (width !== event.data.width || height !== event.data.height) nextWindow.setSize(width, height);
  }));
  lifecycle.add(onceWindowEvent(nextWindow, "close", () => {
    // Do not leave global shortcuts disabled if the settings window closes while
    // its keybinding picker is armed.
    void overlayWindow.withWindow((overlay) => overlay.setShortcutCapture(false));
    lifecycle.dispose();
    if (settingsWindow === nextWindow) {
      settingsWindow = undefined;
      settingsLifecycle = undefined;
    }
  }));
}

async function setCaptureAdapter(deviceName: string | null): Promise<LauncherState> {
  const nextSelection = deviceName ?? "auto";
  await capture.reconfigure(deviceName ?? undefined);
  settings.captureAdapter = nextSelection;
  await launcherSettingsPersistence.flush(settings);
  launcherState = { ...launcherState, selectedAdapter: nextSelection };
  await refreshCaptureDevices();
  return launcherState;
}

async function setLauncherUiScale(uiScale: typeof settings.uiScale): Promise<LauncherState> {
  settings.uiScale = setUiScale(uiScale);
  launcherState = { ...launcherState, uiScale: settings.uiScale };
  launcherSettingsPersistence.schedule(settings);
  publish();
  return launcherState;
}

function setMinimizeToTray(minimizeToTray: boolean): LauncherState {
  settings.minimizeToTray = minimizeToTray;
  launcherState = { ...launcherState, minimizeToTray };
  launcherSettingsPersistence.schedule(settings);
  publish();
  return launcherState;
}

function setResetMeterOnMapChange(resetMeterOnMapChange: boolean): LauncherState {
  settings.resetMeterOnMapChange = resetMeterOnMapChange;
  launcherState = { ...launcherState, resetMeterOnMapChange };
  launcherSettingsPersistence.schedule(settings);
  publish();
  return launcherState;
}

/**
 * Mirrors the overlay's keybinds onto the launcher so it can show them as a hint. The overlay
 * republishes its settings state several times a second, so this only pushes on a real change.
 */
function rememberOverlayShortcuts(shortcuts: Record<KeybindAction, string>): void {
  const current = launcherState.overlayShortcuts;
  if (current && KEYBIND_ACTIONS.every((action) => current[action] === shortcuts[action])) return;
  launcherState = { ...launcherState, overlayShortcuts: { ...shortcuts } };
  publish();
}

function minimizeLauncher(): void {
  if (launcherMinimizeAction(settings.minimizeToTray) === "hide") {
    launcherWindow.hide();
    return;
  }
  launcherWindow.minimize();
}

async function closeLauncher(): Promise<void> {
  await shutdown();
}

function showLauncher(): void {
  launcherWindow.show();
  launcherWindow.activate();
}

function publish(): void {
  if (!launcherWindow) return;
  try { rpc.send.stateChanged(launcherState); } catch { /* The view may still be connecting. */ }
  void publishSettings();
}

async function sharedSettingsState() {
  const overlay = await overlayWindow.withWindow((managed) => managed.getSettingsState());
  return { launcher: launcherState, overlay };
}

async function publishSettings(overlayState?: Awaited<ReturnType<typeof sharedSettingsState>>["overlay"]): Promise<void> {
  if (!settingsWindow) return;
  try {
    settingsRpc.send.stateChanged(overlayState
      ? { launcher: launcherState, overlay: overlayState }
      : await sharedSettingsState());
  } catch { /* Settings may be connecting or closing. */ }
}

function updateStorageWarning(): void {
  launcherState = {
    ...launcherState,
    storageWarning: characterStorageWarning ?? launcherSettingsStorageWarning ?? placementStorageWarning ?? actorIdentityStorageWarning,
  };
  publish();
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  placements.remember("launcher", launcherWindow.getFrame());
  launcherLifecycle.dispose();
  settingsLifecycle?.dispose();
  settingsLifecycle = undefined;
  launcherWindow.hide();
  settingsWindow?.close();
  try {
    await Promise.all([combatWindow.close(), overlayWindow.close(), rewardsWindow.close(), marketWindow.close(), characterWindow.close(), buildExportWindow.close()]);
    liveDeathLogWindow.close();
    unsubscribeCharacterPersistence();
    const character = capture.characterState().snapshot;
    if (character?.source === "live") characterCache = updateCharacterCache(characterCache, character);
    await characterPersistence.flush(characterCache);
    await actorIdentityPersistence.flush(actorIdentityCache);
    await launcherSettingsPersistence.flush();
    await placements.flush();
    xpTracker.shutdown();
    await readModel.close();
  } finally {
    try { await capture.stop(); } finally { Utils.quit(); }
  }
}
