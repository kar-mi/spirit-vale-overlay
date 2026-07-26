import Electrobun, { BrowserView, BrowserWindow, Tray, Utils } from "electrobun/bun";
import { applyRoundedCorners, makeProcessDpiAware } from "@spiritvale/ui-core/win32";
import { getNpcapStatus, listNpcapDevices, resolveCaptureDevice } from "@kar-mi/spirit-vale-tools-capture/capture";

import { createMarketWindow } from "@spiritvale/market-ui";
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
import { createCharacterWindow } from "./character-window.ts";
import { createDpsWindow } from "@spiritvale/combat-ui";
import { createOverlayWindow } from "@spiritvale/overlay";
import { isWorkspaceDevelopmentRoot } from "@spiritvale/ui-core/local-storage";
import { resolveLocalRoot } from "./paths.ts";
import { SafeSaveQueue } from "@spiritvale/ui-core/safe-save";
import { WindowSlot } from "./window-slot.ts";
import { migrateLegacyUserData, resolveDesktopStoragePaths } from "./portable-paths.ts";
import type { WindowFrame } from "@spiritvale/ui-core/window-chrome";
import { registerUiScaleWindow, scaledSize, setUiScale } from "@spiritvale/ui-core/ui-scale";
import { WindowPlacementStore } from "@spiritvale/ui-core/window-placement";
import { launcherMinimizeAction, trayAction } from "./launcher-tray-actions.ts";

makeProcessDpiAware();

const localRoot = resolveLocalRoot();
const storagePaths = resolveDesktopStoragePaths({
  root: localRoot,
  workspaceDev: isWorkspaceDevelopmentRoot(localRoot),
  portable: Boolean(process.env.SPIRIT_VALE_PORTABLE_ROOT?.trim()),
  logDirectoryOverride: process.env.SPIRIT_VALE_LOG_DIRECTORY,
});
await migrateLegacyUserData(storagePaths, Utils.paths.userData);
const logDirectory = storagePaths.logDirectory;
const settings = await loadLauncherSettings(storagePaths.launcherSettingsPath);
setUiScale(settings.uiScale);
let placementStorageWarning: string | undefined;
const placements = await WindowPlacementStore.load(storagePaths.windowPlacementsPath, {
  onWarning: (warning) => { placementStorageWarning = warning; updateStorageWarning(); },
});
let launcherWindow: BrowserWindow;
let settingsWindow: BrowserWindow | undefined;
let launcherState: LauncherState = {
  captureStatus: "starting",
  statusDetail: "Checking Npcap…",
  npcapAvailability: "checking",
  npcapDetail: "Checking Npcap…",
  selectedAdapter: settings.captureAdapter,
  adapterFallback: false,
  adapters: [],
  uiScale: settings.uiScale,
  minimizeToTray: settings.minimizeToTray,
};
let shuttingDown = false;
let characterStorageWarning: string | undefined;
let launcherSettingsStorageWarning: string | undefined;
let actorIdentityStorageWarning: string | undefined;

const launcherSettingsPersistence = new SafeSaveQueue<typeof settings>({
  label: "launcher settings",
  save: (value) => saveLauncherSettings(value, storagePaths.launcherSettingsPath),
  onWarning: (warning) => { launcherSettingsStorageWarning = warning; updateStorageWarning(); },
});
let characterCache: CharacterSnapshotCache = { characters: [] };
const characterPersistence = new SafeSaveQueue<CharacterSnapshotCache>({
  label: "character snapshot",
  save: (value) => saveCharacterCache(value, storagePaths.characterStatePath),
  onWarning: (warning) => { characterStorageWarning = warning; updateStorageWarning(); },
});
let actorIdentityCache: ActorIdentityCache = await loadActorIdentityCache(storagePaths.actorIdentitiesPath);
const actorIdentityPersistence = new SafeSaveQueue<ActorIdentityCache>({
  label: "actor identities",
  save: (value) => saveActorIdentityCache(value, storagePaths.actorIdentitiesPath),
  onWarning: (warning) => { actorIdentityStorageWarning = warning; updateStorageWarning(); },
});

const combatWindow = new WindowSlot((onClosed) => createDpsWindow({
  logDirectory,
  settingsPath: storagePaths.dpsSettingsPath,
  placements,
  onClosed,
  onOpenOverlay: () => overlayWindow.open(),
  onReset: () => capture.resetSession(),
}));
const overlayWindow = new WindowSlot((onClosed) => createOverlayWindow({
  logDirectory,
  getCharacterState: () => capture.characterState(),
  subscribeCharacter: (listener) => capture.subscribeCharacter(listener),
  settingsPath: storagePaths.overlaySettingsPath,
  placements,
  showSettingsOnCreate: false,
  lockOnCreate: true,
  onReset: () => capture.resetSession(),
  onClosed,
}));
const rewardsWindow = new WindowSlot((onClosed) => createRewardsWindow({
  logDirectory,
  settingsPath: storagePaths.rewardsSettingsPath,
  placements,
  onClosed,
  onReset: () => capture.resetSession(),
}));
const marketWindow = new WindowSlot((onClosed) => createMarketWindow({ logDirectory, placements, onClosed }));

const capture = new CaptureCoordinator({
  logDirectory,
  deviceName: settings.captureAdapter === "auto" ? undefined : settings.captureAdapter,
  onStatus: (state) => {
    launcherState = { ...launcherState, ...state };
    publish();
  },
  knownIdentities: actorIdentityCache.entries,
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
      ...sharedLauncherHandlers(() => settingsWindow, { x: 110, y: 110, width: 658, height: 570 }),
      windowAction: ({ action }) => {
        if (action === "minimize") settingsWindow?.minimize();
        else settingsWindow?.close();
      },
    },
    messages: {},
  },
});

launcherWindow = new BrowserWindow({
  title: "Spirit Vale",
  url: "views://launcherview/index.html",
  frame: placements.frame("launcher", { x: 80, y: 80, width: 1200, height: 538 }, { width: 900, height: 430 }),
  titleBarStyle: "hidden",
  transparent: false,
  rpc,
});
applyRoundedCorners(launcherWindow.ptr);
registerUiScaleWindow(launcherWindow, { scaleInitialFrame: false });
placements.track("launcher", launcherWindow);

const tray = new Tray({
  title: "Spirit Vale",
  image: "views://assets/app-icon.ico",
  width: 32,
  height: 32,
});
tray.setMenu([
  { type: "normal", label: "Main launcher", action: "show-launcher" },
  { type: "normal", label: "Combat", action: "open-combat" },
  { type: "normal", label: "Overlay", action: "open-overlay" },
  { type: "normal", label: "Rewards", action: "open-rewards" },
  { type: "normal", label: "Market", action: "open-market" },
  { type: "divider" },
  { type: "normal", label: "Exit", action: "exit" },
]);
tray.on("tray-clicked", (event) => {
  const action = trayAction((event as { data: { action: string } }).data.action);
  if (action === "show-launcher") showLauncher();
  else if (action === "open-combat") void openTool("combat");
  else if (action === "open-overlay") void openTool("overlay");
  else if (action === "open-rewards") void openTool("rewards");
  else if (action === "open-market") void openTool("market");
  else if (action === "exit") void shutdown();
});

Electrobun.events.on(`resize-${launcherWindow.id}`, (event: { data: { width: number; height: number } }) => {
  const width = Math.max(scaledSize(900), event.data.width);
  const height = Math.max(scaledSize(430), event.data.height);
  if (width !== event.data.width || height !== event.data.height) launcherWindow.setSize(width, height);
});
launcherWindow.on("close", () => void shutdown());

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
void initializeCapture();
void overlayWindow.open().catch((error) => {
  console.error(`[overlay] startup failed: ${error instanceof Error ? error.message : String(error)}`);
});

async function initializeCapture(): Promise<void> {
  await refreshCaptureDevices();
  if (launcherState.npcapAvailability !== "ready") {
    launcherState = { ...launcherState, captureStatus: "unavailable", statusDetail: launcherState.npcapDetail };
    publish();
    return;
  }
  await capture.start();
}

async function refreshCaptureDevices(): Promise<void> {
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
  try {
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
    launcherState = {
      ...launcherState,
      npcapAvailability: "error",
      npcapDetail: error instanceof Error ? error.message : String(error),
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
  else await characterWindow.open();
}

function openSettings(): void {
  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.activate();
    return;
  }
  const nextWindow = new BrowserWindow({
    title: "Spirit Vale Packet Capture Settings",
    url: "views://settingsview/index.html",
    frame: placements.frame(
      "launcher-settings",
      { x: 110, y: 110, width: 658, height: 570 },
      { width: 420, height: 360 },
    ),
    titleBarStyle: "hidden",
    transparent: false,
    rpc: settingsRpc,
  });
  settingsWindow = nextWindow;
  applyRoundedCorners(nextWindow.ptr);
  registerUiScaleWindow(nextWindow, { scaleInitialFrame: false });
  placements.track("launcher-settings", nextWindow);
  Electrobun.events.on(`resize-${nextWindow.id}`, (event: { data: { width: number; height: number } }) => {
    const width = Math.max(scaledSize(420), event.data.width);
    const height = Math.max(scaledSize(360), event.data.height);
    if (width !== event.data.width || height !== event.data.height) nextWindow.setSize(width, height);
  });
  nextWindow.on("close", () => { if (settingsWindow === nextWindow) settingsWindow = undefined; });
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
  try { settingsRpc.send.stateChanged(launcherState); } catch { /* The view may still be connecting. */ }
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
  launcherWindow.hide();
  settingsWindow?.close();
  try {
    await Promise.all([combatWindow.close(), overlayWindow.close(), rewardsWindow.close(), marketWindow.close(), characterWindow.close()]);
    unsubscribeCharacterPersistence();
    const character = capture.characterState().snapshot;
    if (character?.source === "live") characterCache = updateCharacterCache(characterCache, character);
    await characterPersistence.flush(characterCache);
    await actorIdentityPersistence.flush(actorIdentityCache);
    await launcherSettingsPersistence.flush();
    await placements.flush();
  } finally {
    try { await capture.stop(); } finally { Utils.quit(); }
  }
}
