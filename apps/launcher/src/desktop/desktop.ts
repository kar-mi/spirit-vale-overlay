import path from "node:path";
import DesktopRuntime, { BrowserView, BrowserWindow, Screen, Tray, Utils, isDesktopWindowProcess } from "@svoverlay/desktop-runtime";
import { applyRoundedCorners, makeProcessDpiAware, setWindowIcon } from "@svoverlay/desktop-platform/win32";
import { appIconPath } from "@svoverlay/desktop-platform/window-publish";
import { getNpcapStatus, listNpcapDevices, resolveCaptureDevice } from "@kar-mi/spirit-vale-tools-capture/capture";

import { createBuildExportWindow } from "@svoverlay/build-export";
import { createRewardsWindow } from "@svoverlay/rewards";
import type { LauncherRpc, LauncherSettingsRpc, LauncherState, ManageSettingsRpc, ToolWindow } from "../launcher/types.ts";
import { loadLauncherSettings, saveLauncherSettings } from "../launcher/settings.ts";
import {
  applyImport,
  exportSingleSetting,
  importSingleSetting,
  planImport,
  resetAllSettings,
  settingsKindFileName,
  settingsKindPath,
  type SettingsKind,
} from "./manage-settings.ts";
import {
  activeCharacterSnapshot,
  loadCharacterCache,
  saveCharacterCache,
  updateCharacterCache,
  type CharacterSnapshotCache,
} from "../character/storage.ts";
import { InspectedCharacterStore } from "../character/inspected-character-store.ts";
import { DurableInspectedCharacterRoster } from "../character/durable-inspected-character-roster.ts";
import {
  loadActorIdentityCache,
  saveActorIdentityCache,
  updateActorIdentityCache,
  type ActorIdentityCache,
} from "./actor-identity-storage.ts";
import { compareBossRegions } from "@svoverlay/contracts/boss-timers";
import type { BossTimerWindowState } from "../boss-timers/rpc.ts";
import { CaptureCoordinator } from "./capture-coordinator.ts";
import { createBossTimerCoordinator } from "./boss-timer-coordinator.ts";
import { createBossTimerWindow } from "./boss-timer-window.ts";
import { createXpTrackerCoordinator } from "./xp-tracker-coordinator.ts";
import { createReadModelService } from "./read-model-service.ts";
import { measureLogStorage } from "./log-storage.ts";
import { createCharacterWindow } from "./character-window.ts";
import { createDeathLogWindow, createDpsWindow } from "@svoverlay/combat";
import { createOverlayWindow } from "@svoverlay/overlay";
import { KEYBIND_ACTIONS, type KeybindAction } from "@svoverlay/overlay/app-types";
import { resolveLocalRoot } from "./paths.ts";
import { SafeSaveQueue } from "@svoverlay/desktop-platform/safe-save";
import { WindowSlot } from "./window-slot.ts";
import { resolveDesktopStoragePaths } from "./portable-paths.ts";
import type { WindowFrame } from "@svoverlay/ui-kit/window-chrome";
import { registerUiScaleWindow, scaledSize, setUiScale } from "@svoverlay/desktop-platform/ui-scale-window";
import { WindowPlacementStore } from "@svoverlay/desktop-platform/window-placement";
import { launcherMinimizeAction, trayAction } from "./launcher-tray-actions.ts";
import { findAvailableUpdate } from "../launcher/update-check.ts";
import { DisposableStore, onWindowEvent, onceWindowEvent } from "@svoverlay/desktop-platform/window-lifecycle";
import { HumanReadableErrorLog } from "./human-readable-error-log.ts";

console.log("Hello from ./launcher/src/desktop/desktop.ts");

makeProcessDpiAware();

const localRoot = resolveLocalRoot();
const appVersion = (await DesktopRuntime.Updater.getLocalInfo()).version;
const storagePaths = resolveDesktopStoragePaths({
  root: localRoot,
  logDirectoryOverride: process.env.SPIRIT_VALE_LOG_DIRECTORY,
});
const logDirectory = storagePaths.logDirectory;
const errorLog = new HumanReadableErrorLog(localRoot);
const readModel = await createReadModelService({ logDirectory });
const xpTracker = createXpTrackerCoordinator({ logDirectory });
let bossTimerStorageWarning: string | undefined;
const bossTimers = await createBossTimerCoordinator({
  storagePath: storagePaths.bossTimersPath,
  onWarning: (warning) => { bossTimerStorageWarning = warning; updateStorageWarning(); },
});
const settings = await loadLauncherSettings(storagePaths.launcherSettingsPath);
setUiScale(settings.uiScale);
let placementStorageWarning: string | undefined;
const placements = await WindowPlacementStore.load(storagePaths.windowPlacementsPath, {
  onWarning: (warning) => { placementStorageWarning = warning; updateStorageWarning(); },
});
let launcherWindow: BrowserWindow;
let settingsWindow: BrowserWindow | undefined;
let settingsLifecycle: DisposableStore | undefined;
let manageSettingsWindow: BrowserWindow | undefined;
let manageSettingsLifecycle: DisposableStore | undefined;
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
  resetGoldOnMapChange: settings.resetGoldOnMapChange,
};
let shuttingDown = false;
let characterStorageWarning: string | undefined;
let inspectedCharacterStorageWarning: string | undefined;
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
  // `updateCharacterCache` returns a fresh cache that nothing mutates afterwards, so the queue does not need its own copy.
  clone: false,
  save: (value) => saveCharacterCache(value, storagePaths.characterStatePath),
  onWarning: (warning) => { characterStorageWarning = warning; updateStorageWarning(); },
});
const inspectedCharacterStore = new InspectedCharacterStore(storagePaths.inspectedCharactersPath);
const inspectedCharacterRoster = new DurableInspectedCharacterRoster(inspectedCharacterStore, {
  onPersistenceError: (error) => {
    inspectedCharacterStorageWarning = error === undefined
      ? undefined
      : `Could not save inspected characters: ${error instanceof Error ? error.message : String(error)}`;
    updateStorageWarning();
  },
});
let actorIdentityCache: ActorIdentityCache = await loadActorIdentityCache(storagePaths.actorIdentitiesPath);
const actorIdentityPersistence = new SafeSaveQueue<ActorIdentityCache>({
  label: "actor identities",
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
  subscribeActiveStatuses: (listener) => capture.subscribeActiveStatuses(listener),
  subscribeMinimap: (listener) => capture.subscribeMinimap(listener),
  subscribeLootToast: (listener) => capture.subscribeLootToast(listener),
  xp: xpTracker,
  bossTimers,
  settingsPath: storagePaths.overlaySettingsPath,
  // No `placements` here: each overlay surface is pinned to a whole display, so there is no user-moved frame to remember.
  lockOnCreate: true,
  isAppProcess: isDesktopWindowProcess,
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
const capture = new CaptureCoordinator({
  logDirectory,
  deviceName: settings.captureAdapter === "auto" ? undefined : settings.captureAdapter,
  onStatus: (state) => {
    launcherState = { ...launcherState, ...state };
    publish();
  },
  onError: (report) => errorLog.write(report),
  resetOnMapChange: () => settings.resetMeterOnMapChange,
  onGoldMapChange: () => { if (settings.resetGoldOnMapChange) xpTracker.resetCoins(); },
  minimapEnabled: () => overlayWindow.current?.getSettingsState().elements.minimap.enabled ?? true,
  getMinimapRarityFilter: () => overlayWindow.current?.getSettingsState().minimapRarityFilter ?? 2,
  getMinimapLootChanceFilter: () => overlayWindow.current?.getSettingsState().minimapLootChanceFilter ?? 100,
  knownIdentities: [...actorIdentityCache.entries.values()],
  onIdentityLearned: (identity) => {
    actorIdentityCache = updateActorIdentityCache(actorIdentityCache, { ...identity, lastSeenAtMs: Date.now() });
    actorIdentityPersistence.schedule(actorIdentityCache);
  },
  onBossGravestone: (gravestone) => bossTimers.recordGravestone(gravestone),
  onServerInstance: (instanceId) => bossTimers.setCurrentInstance(instanceId),
});
characterCache = await loadCharacterCache(storagePaths.characterStatePath);
capture.setCachedCharacter(activeCharacterSnapshot(characterCache));
const unsubscribeCharacterPersistence = capture.subscribeCharacter((state) => {
  bossTimers.setPlayerName(state.snapshot?.name);
  if (!state.snapshot || state.snapshot.source !== "live") return;
  characterCache = updateCharacterCache(characterCache, state.snapshot);
  characterPersistence.schedule(characterCache);
});
const unsubscribeInspectedCharacterPersistence = capture.subscribeInspectedCharacters((roster) => {
  inspectedCharacterRoster.ingest(roster);
});
const characterWindow = new WindowSlot((onClosed) => createCharacterWindow({
  getState: () => capture.characterState(),
  subscribe: (listener) => capture.subscribeCharacter(listener),
  placements,
  onClosed,
  onOpenSettings: openSettings,
}));
const bossTimerWindow = new WindowSlot((onClosed) => createBossTimerWindow({
  getState: bossTimerWindowState,
  subscribe: (listener) => bossTimers.subscribe(listener),
  addTimer: (entry) => {
    bossTimers.addManualTimer({
      ...entry,
      // Falls back to where the player is now, which is where a gravestone they just saw must be.
      region: entry.region ?? bossTimers.currentInstanceId(),
    });
  },
  removeTimer: (id) => { bossTimers.removeTimer(id); },
  placements,
  onClosed,
  onOpenSettings: openSettings,
}));
const buildExportWindow = new WindowSlot((onClosed) => createBuildExportWindow({
  getCharacter: () => capture.characterState().snapshot,
  subscribeCharacter: (listener) => capture.subscribeCharacter(listener),
  getInspected: () => inspectedCharacterRoster.list(),
  subscribeInspected: (listener) => inspectedCharacterRoster.subscribe(listener),
  deleteInspected: (name) => { inspectedCharacterRoster.delete(name); },
  clearInspected: () => { inspectedCharacterRoster.clear(); },
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
      manageSettings: () => { openManageSettings(); },
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
      setResetGoldOnMapChange: async ({ resetGoldOnMapChange }) => {
        setResetGoldOnMapChange(resetGoldOnMapChange);
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
      setAutoHideWhenUnfocused: async ({ enabled }) => {
        await overlayWindow.withWindow((overlay) => overlay.setAutoHideWhenUnfocused(enabled));
        return sharedSettingsState();
      },
      setShortcut: async ({ action, shortcut }) => {
        await overlayWindow.withWindow((overlay) => overlay.setShortcut(action, shortcut));
        return sharedSettingsState();
      },
      resetShortcutsToDefaults: async () => {
        await overlayWindow.withWindow((overlay) => overlay.resetShortcutsToDefaults());
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
      setPersonalDpsMode: async ({ mode }) => {
        await overlayWindow.withWindow((overlay) => overlay.setPersonalDpsMode(mode));
        return sharedSettingsState();
      },
      setMinimapRarityFilter: async ({ rarity }) => {
        await overlayWindow.withWindow((overlay) => overlay.setMinimapRarityFilter(rarity));
        return sharedSettingsState();
      },
      setMinimapLootChanceFilter: async ({ chance }) => {
        await overlayWindow.withWindow((overlay) => overlay.setMinimapLootChanceFilter(chance));
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

function readDisplays() {
  const all = Screen.getAllDisplays();
  if (all.length > 0) return all;
  // getAllDisplays returns nothing if the FFI call fails; primary is always answerable.
  return [Screen.getPrimaryDisplay()];
}

async function importSettingsAndClose(): Promise<void> {
  const [selected] = await Utils.openFileDialog({
    canChooseDirectory: true,
    canChooseFiles: false,
    allowsMultipleSelection: false,
    startingFolder: localRoot,
  });
  if (!selected) return;
  const plan = planImport(selected, storagePaths);
  if (plan.status === "same-folder") {
    await Utils.showMessageBox({
      type: "info",
      title: "Manage Settings",
      message: "That's already your current settings folder — nothing to import.",
      buttons: ["OK"],
      defaultId: 0,
      cancelId: 0,
    });
    return;
  }
  if (plan.status === "not-found") {
    await Utils.showMessageBox({
      type: "warning",
      title: "Manage Settings",
      message: "No Spirit Vale Overlay settings were found in that folder.",
      buttons: ["OK"],
      defaultId: 0,
      cancelId: 0,
    });
    return;
  }
  try {
    await closeAllWindowsAndFlush();
    await applyImport(plan.oldPaths, storagePaths, readDisplays());
    await Utils.showMessageBox({
      type: "info",
      title: "Manage Settings",
      message: "Settings imported. Spirit Vale Overlay will now close — please reopen it to use the imported settings.",
      buttons: ["OK"],
      defaultId: 0,
      cancelId: 0,
    });
  } finally {
    await quitImmediately();
  }
}

async function importSingleSettingAndClose(kind: SettingsKind): Promise<void> {
  const [selected] = await Utils.openFileDialog({
    canChooseDirectory: false,
    canChooseFiles: true,
    allowsMultipleSelection: false,
    allowedFileTypes: "json",
    startingFolder: path.dirname(settingsKindPath(kind, storagePaths)),
  });
  if (!selected) return;
  try {
    await closeAllWindowsAndFlush();
    await importSingleSetting(kind, selected, storagePaths, readDisplays());
    await Utils.showMessageBox({
      type: "info",
      title: "Manage Settings",
      message: "Settings imported. Spirit Vale Overlay will now close — please reopen it to use the imported settings.",
      buttons: ["OK"],
      defaultId: 0,
      cancelId: 0,
    });
  } finally {
    await quitImmediately();
  }
}

async function exportSettingAndNotify(kind: SettingsKind): Promise<void> {
  const destination = await Utils.showSaveDialog({
    defaultPath: path.join(localRoot, settingsKindFileName(kind)),
    filters: ["json"],
  });
  if (!destination) return;
  await exportSingleSetting(kind, storagePaths, destination, readDisplays());
  await Utils.showMessageBox({
    type: "info",
    title: "Manage Settings",
    message: "Settings exported.",
    buttons: ["OK"],
    defaultId: 0,
    cancelId: 0,
  });
}

function openSettingsDataFolder(): void {
  Utils.showItemInFolder(storagePaths.launcherSettingsPath);
}

async function resetSettingsAndClose(): Promise<void> {
  try {
    await closeAllWindowsAndFlush();
    await resetAllSettings(storagePaths, readDisplays());
    await Utils.showMessageBox({
      type: "info",
      title: "Manage Settings",
      message: "Settings reset. Spirit Vale Overlay will now close — please reopen it.",
      buttons: ["OK"],
      defaultId: 0,
      cancelId: 0,
    });
  } finally {
    await quitImmediately();
  }
}

const manageSettingsRpc = BrowserView.defineRPC<ManageSettingsRpc>({
  maxRequestTime: 30_000,
  handlers: {
    requests: {
      getState: () => ({ dataFolder: path.dirname(storagePaths.launcherSettingsPath) }),
      importSettings: () => importSettingsAndClose(),
      importSetting: ({ kind }) => importSingleSettingAndClose(kind),
      exportSetting: ({ kind }) => exportSettingAndNotify(kind),
      openDataFolder: () => { openSettingsDataFolder(); },
      resetSettings: () => resetSettingsAndClose(),
      getWindowFrame: () => manageSettingsWindow?.getFrame() ?? { x: 130, y: 130, width: 480, height: 380 },
      setWindowFrame: ({ x, y, width, height }) => { manageSettingsWindow?.setFrame(x, y, width, height); },
      windowAction: async ({ action }) => {
        if (action === "minimize") manageSettingsWindow?.minimize();
        else manageSettingsWindow?.close();
      },
    },
    messages: {},
  },
});

function openManageSettings(): void {
  if (manageSettingsWindow) {
    manageSettingsWindow.show();
    manageSettingsWindow.activate();
    return;
  }
  const nextWindow = new BrowserWindow({
    title: "Manage Settings",
    url: "views://managesettingsview/index.html",
    frame: placements.frame(
      "manage-settings",
      { x: 130, y: 130, width: 480, height: 380 },
      { width: 420, height: 340 },
    ),
    titleBarStyle: "hidden",
    transparent: false,
    rpc: manageSettingsRpc,
  });
  const lifecycle = new DisposableStore();
  manageSettingsWindow = nextWindow;
  manageSettingsLifecycle = lifecycle;
  applyRoundedCorners(nextWindow.ptr);
  setWindowIcon(nextWindow.ptr, appIconPath);
  lifecycle.add(registerUiScaleWindow(nextWindow, { scaleInitialFrame: false }));
  lifecycle.add(placements.track("manage-settings", nextWindow));
  lifecycle.add(onWindowEvent(nextWindow, "resize", (event: { data: { width: number; height: number } }) => {
    const width = Math.max(scaledSize(420), event.data.width);
    const height = Math.max(scaledSize(340), event.data.height);
    if (width !== event.data.width || height !== event.data.height) nextWindow.setSize(width, height);
  }));
  lifecycle.add(onceWindowEvent(nextWindow, "close", () => {
    lifecycle.dispose();
    if (manageSettingsWindow === nextWindow) {
      manageSettingsWindow = undefined;
      manageSettingsLifecycle = undefined;
    }
  }));
}

async function openTool(tool: ToolWindow): Promise<void> {
  if (tool === "combat") await combatWindow.open();
  else if (tool === "overlay") await overlayWindow.open();
  else if (tool === "rewards") await rewardsWindow.open();
  else if (tool === "build-export") await buildExportWindow.open();
  else if (tool === "boss-timers") await bossTimerWindow.open();
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
    // Do not leave global shortcuts disabled if the settings window closes while its keybinding picker is armed.
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

function setResetGoldOnMapChange(resetGoldOnMapChange: boolean): LauncherState {
  settings.resetGoldOnMapChange = resetGoldOnMapChange;
  launcherState = { ...launcherState, resetGoldOnMapChange };
  launcherSettingsPersistence.schedule(settings);
  publish();
  return launcherState;
}

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

function bossTimerWindowState(): BossTimerWindowState {
  const { timers, currentRegion, playerName } = bossTimers.getState();
  const currentInstanceId = bossTimers.currentInstanceId();
  const knownRegions = [...new Set([
    ...(currentRegion === undefined ? [] : [currentRegion]),
    ...timers.flatMap((timer) => timer.region === undefined ? [] : [timer.region]),
  ])].sort(compareBossRegions);
  return {
    timers,
    options: bossTimers.bossOptions(),
    ...(currentInstanceId === undefined ? {} : { currentInstanceId }),
    ...(currentRegion === undefined ? {} : { currentRegion }),
    ...(playerName === undefined ? {} : { playerName }),
    knownRegions,
  };
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
    storageWarning: characterStorageWarning ?? inspectedCharacterStorageWarning ?? launcherSettingsStorageWarning ?? placementStorageWarning ?? actorIdentityStorageWarning ?? bossTimerStorageWarning,
  };
  publish();
}

async function closeAllWindowsAndFlush(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  placements.remember("launcher", launcherWindow.getFrame());
  launcherLifecycle.dispose();
  settingsLifecycle?.dispose();
  settingsLifecycle = undefined;
  manageSettingsLifecycle?.dispose();
  manageSettingsLifecycle = undefined;
  launcherWindow.hide();
  settingsWindow?.close();
  manageSettingsWindow?.close();
  await Promise.all([combatWindow.close(), overlayWindow.close(), rewardsWindow.close(), characterWindow.close(), buildExportWindow.close(), bossTimerWindow.close()]);
  liveDeathLogWindow.close();
  unsubscribeCharacterPersistence();
  unsubscribeInspectedCharacterPersistence();
  const character = capture.characterState().snapshot;
  if (character?.source === "live") characterCache = updateCharacterCache(characterCache, character);
  await characterPersistence.flush(characterCache);
  await actorIdentityPersistence.flush(actorIdentityCache);
  await launcherSettingsPersistence.flush();
  await placements.flush();
  inspectedCharacterRoster.close();
  xpTracker.shutdown();
  await bossTimers.shutdown();
  await readModel.close();
}

async function quitImmediately(): Promise<void> {
  try { await capture.stop(); } finally { Utils.quit(); }
}

async function shutdown(): Promise<void> {
  try {
    await closeAllWindowsAndFlush();
  } finally {
    await quitImmediately();
  }
}
