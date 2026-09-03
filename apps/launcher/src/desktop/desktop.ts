import path from "node:path";
import DesktopRuntime, { BrowserView, BrowserWindow, Screen, Tray, Utils, isDesktopWindowProcess } from "@svoverlay/desktop-runtime";
import { applyRoundedCorners, makeProcessDpiAware, setWindowIcon } from "@svoverlay/desktop-platform/win32";
import { appIconPath } from "@svoverlay/desktop-platform/window-publish";
import { getNpcapStatus, listNpcapDevices, resolveCaptureDevice } from "@kar-mi/spirit-vale-tools-capture/capture";
import { inspectCombatReplaySummary } from "@kar-mi/spirit-vale-tools-combat";
import { streamSessionPath } from "@kar-mi/spirit-vale-tools-logging";
import { inspectRewardsReplaySummary } from "@kar-mi/spirit-vale-tools-rewards";

import { createBuildExportWindow } from "@svoverlay/build-export";
import { createRewardsWindow } from "@svoverlay/rewards";
import type { LauncherRpc, LauncherSettingsRpc, LauncherState, SettingsSectionId, SharedSettingsState, ToolWindow } from "../launcher/types.ts";
import { loadLauncherSettings, saveLauncherSettings, type LauncherSettings } from "../launcher/settings.ts";
import type { LocaleCode } from "@svoverlay/i18n/locale";
import type { LocalizedText, MessageKey } from "@svoverlay/i18n/messages";
import { englishText, message, translate } from "@svoverlay/i18n/backend";
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
import { CaptureCoordinator, type CaptureErrorReport } from "./capture-coordinator.ts";
import { createBossTimerCoordinator } from "./boss-timer-coordinator.ts";
import { createBossTimerWindow } from "./boss-timer-window.ts";
import { createXpTrackerCoordinator } from "./xp-tracker-coordinator.ts";
import { createReadModelService } from "./read-model-service.ts";
import { measureLogStorage } from "./log-storage.ts";
import { createCharacterWindow } from "./character-window.ts";
import { createDeathLogWindow, createDpsWindow } from "@svoverlay/combat";
import { readCombatLocations } from "@svoverlay/combat/zone-log";
import { createOverlayWindow } from "@svoverlay/overlay";
import {
  KEYBIND_ACTIONS,
  type KeybindAction,
  type OverlayElementId,
  type PersonalDpsMode,
  type RequiredStatusCategory,
} from "@svoverlay/overlay/app-types";
import { resolveLocalStorageRoot } from "@svoverlay/desktop-platform/local-storage";
import { SafeSaveQueue } from "@svoverlay/desktop-platform/safe-save";
import { WindowSlot } from "./window-slot.ts";
import { resolveDesktopStoragePaths } from "./portable-paths.ts";
import type { WindowFrame } from "@svoverlay/ui-kit/window-chrome";
import { registerUiScaleWindow, scaledSize, setUiScale } from "@svoverlay/desktop-platform/ui-scale-window";
import { registerLocaleWindow, setActiveLocale } from "@svoverlay/desktop-platform/locale-window";
import { WindowPlacementStore } from "@svoverlay/desktop-platform/window-placement";
import { launcherMinimizeAction, trayAction } from "./launcher-tray-actions.ts";
import { findAvailableUpdate } from "../launcher/update-check.ts";
import { DisposableStore, onWindowEvent, onceWindowEvent } from "@svoverlay/desktop-platform/window-lifecycle";
import { HumanReadableErrorLog } from "./human-readable-error-log.ts";
import { verifyWritableDirectories } from "@svoverlay/desktop-platform/startup-preflight";
import { loadSessionSummaryJournal, normalizeHistorySessionLimit } from "@svoverlay/desktop-platform/session-summary-journal";

makeProcessDpiAware();

const localRoot = resolveLocalStorageRoot();
const appVersion = (await DesktopRuntime.Updater.getLocalInfo()).version;
const storagePaths = resolveDesktopStoragePaths({
  root: localRoot,
  logDirectoryOverride: process.env.SPIRIT_VALE_LOG_DIRECTORY,
});
const logDirectory = storagePaths.logDirectory;
let summaryJournalPromise: ReturnType<typeof loadSessionSummaryJournal> | undefined;
const errorLog = new HumanReadableErrorLog(localRoot);
const warningLog = new HumanReadableErrorLog(localRoot, "warning.log");
await verifyWritableDirectories([
  localRoot,
  path.join(localRoot, "data"),
  path.dirname(storagePaths.launcherSettingsPath),
  logDirectory,
  ...[process.env.LOCALAPPDATA, process.env.APPDATA, process.env.TEMP, process.env.WEBVIEW2_USER_DATA_FOLDER]
    .filter((directory): directory is string => Boolean(process.env.SPIRIT_VALE_PORTABLE_ROOT && directory?.trim())),
], {
  onRetry: (failure, attempt, attempts) => console.warn(
    `[overlay] startup storage retry ${attempt + 1}/${attempts} (${failure.operation}, ${failure.code ?? "no code"}): ${failure.path}: ${failure.message}`,
  ),
  onWarning: (warning) => {
    console.warn(
      `[overlay] non-fatal startup storage warning (${warning.operation}, ${warning.code ?? "no code"}): ${warning.path}: ${warning.message}`,
    );
    warningLog.write({
      title: "Startup storage probe cleanup was delayed",
      reason: warning.message,
      details: { operation: warning.operation, code: warning.code, path: warning.path },
    });
  },
});
/** A storage failure in both forms it is needed in: English for the error log, a code for the view. */
interface StorageWarning {
  english: string;
  text: LocalizedText;
}

/** Active storage failures keyed by source, plus which English texts have already reached the error log. */
const storageWarnings = new Map<string, StorageWarning>();
const loggedStorageWarnings = new Map<string, string>();

/** Every `SafeSaveQueue`/`onWarning` producer reports the same single failure mode. */
function saveFailure(warning: string | undefined): StorageWarning | undefined {
  return warning === undefined ? undefined : { english: warning, text: message("storage.saveFailed") };
}

/** Record or clear a storage failure for `source`: surface one to the view, log each new English text once. */
function reportStorageWarning(source: string, warning: StorageWarning | undefined): void {
  if (warning) storageWarnings.set(source, warning);
  else storageWarnings.delete(source);

  if (!warning) {
    loggedStorageWarnings.delete(source);
  } else if (loggedStorageWarnings.get(source) !== warning.english) {
    loggedStorageWarnings.set(source, warning.english);
    errorLog.write({
      title: `${source} storage warning`,
      reason: warning.english,
      details: { "Storage root": localRoot, "Log directory": logDirectory },
    });
  }

  const active = storageWarnings.values().next().value as StorageWarning | undefined;
  launcherState = { ...launcherState, storageWarning: active?.text };
  publish();
}

/** Both capture log sinks want the same adapter/version context ahead of the report's own details. */
function withCaptureContext(report: CaptureErrorReport): CaptureErrorReport {
  return {
    ...report,
    details: {
      "App version": appVersion,
      "Npcap version": launcherState.npcapVersion,
      "Selected adapter": launcherState.selectedAdapter,
      "Effective adapter": launcherState.effectiveAdapter,
      ...report.details,
    },
  };
}

const readModel = await createReadModelService({ logDirectory });
const xpTracker = createXpTrackerCoordinator({ logDirectory });
const bossTimers = await createBossTimerCoordinator({
  storagePath: storagePaths.bossTimersPath,
  onWarning: (warning) => reportStorageWarning("boss timers", saveFailure(warning)),
});
const settings = await loadLauncherSettings(storagePaths.launcherSettingsPath);
setUiScale(settings.uiScale);
setActiveLocale(settings.language);
const placements = await WindowPlacementStore.load(storagePaths.windowPlacementsPath, {
  onWarning: (warning) => reportStorageWarning("window placements", saveFailure(warning)),
});
let launcherWindow: BrowserWindow;
let settingsWindow: BrowserWindow | undefined;
let settingsLifecycle: DisposableStore | undefined;
// A requested settings section, delivered by a push to an open window or by the next getState.
let pendingSettingsSection: SettingsSectionId | undefined;
const launcherLifecycle = new DisposableStore();
let launcherState: LauncherState = {
  appVersion,
  captureStatus: "starting",
  statusDetail: message("npcap.detail.checking"),
  npcapAvailability: "checking",
  npcapDetail: message("npcap.detail.checking"),
  selectedAdapter: settings.captureAdapter,
  adapterFallback: false,
  adapters: [],
  language: settings.language,
  uiScale: settings.uiScale,
  minimizeToTray: settings.minimizeToTray,
  resetMeterOnMapChange: settings.resetMeterOnMapChange,
  resetGoldOnMapChange: settings.resetGoldOnMapChange,
  pastLogLimit: settings.pastLogLimit,
};
let shuttingDown = false;
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
  onWarning: (warning) => reportStorageWarning("launcher settings", saveFailure(warning)),
});
let characterCache: CharacterSnapshotCache = { characters: [] };
const characterPersistence = new SafeSaveQueue<CharacterSnapshotCache>({
  label: "character snapshot",
  // `updateCharacterCache` returns a fresh cache that nothing mutates afterwards, so the queue does not need its own copy.
  clone: false,
  save: (value) => saveCharacterCache(value, storagePaths.characterStatePath),
  onWarning: (warning) => reportStorageWarning("character snapshot", saveFailure(warning)),
});
const inspectedCharacterStore = new InspectedCharacterStore(storagePaths.inspectedCharactersPath);
const inspectedCharacterRoster = new DurableInspectedCharacterRoster(inspectedCharacterStore, {
  onPersistenceError: (error) => {
    const reason = error === undefined
      ? undefined
      : error instanceof Error ? error.message : String(error);
    reportStorageWarning("inspected characters", reason === undefined ? undefined : {
      english: `Could not save inspected characters: ${reason}`,
      text: message("storage.inspectedCharactersFailed", { reason }),
    });
  },
});
let actorIdentityCache: ActorIdentityCache = await loadActorIdentityCache(storagePaths.actorIdentitiesPath);
const actorIdentityPersistence = new SafeSaveQueue<ActorIdentityCache>({
  label: "actor identities",
  clone: false,
  save: (value) => saveActorIdentityCache(value, storagePaths.actorIdentitiesPath),
  onWarning: (warning) => reportStorageWarning("actor identities", saveFailure(warning)),
});

const combatWindow = new WindowSlot((onClosed) => createDpsWindow({
  logDirectory,
  readModel,
  getCharacterState: () => capture.characterState(),
  subscribeCharacter: (listener) => capture.subscribeCharacter(listener),
  settingsPath: storagePaths.dpsSettingsPath,
  getHistorySessionLimit: () => settings.pastLogLimit,
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
  getHistorySessionLimit: () => settings.pastLogLimit,
  placements,
  onClosed,
  onReset: () => capture.resetSession(),
  onOpenSettings: openSettings,
}));
const capture = new CaptureCoordinator({
  logDirectory,
  deviceName: settings.captureAdapter === "auto" ? undefined : settings.captureAdapter,
  onStatus: (state) => {
    const { captureWarning, ...captureState } = state;
    launcherState = { ...launcherState, ...captureState };
    if (captureWarning) launcherState.captureWarning = captureWarning;
    else delete launcherState.captureWarning;
    publish();
  },
  onError: (report) => errorLog.write(withCaptureContext(report)),
  onWarning: (report) => warningLog.write(withCaptureContext(report)),
  resetOnMapChange: () => settings.resetMeterOnMapChange,
  onGoldMapChange: () => { if (settings.resetGoldOnMapChange) xpTracker.resetCoins(); },
  minimapEnabled: () => {
    const state = overlayWindow.current?.getSettingsState();
    return state === undefined ? true : state.minimapEnabled && state.elements.minimap.enabled;
  },
  getMinimapRarityFilter: () => overlayWindow.current?.getSettingsState().minimapRarityFilter ?? 2,
  getMinimapLootChanceFilter: () => overlayWindow.current?.getSettingsState().minimapLootChanceFilter ?? 100,
  knownIdentities: [...actorIdentityCache.entries.values()],
  onIdentityLearned: (identity) => {
    actorIdentityCache = updateActorIdentityCache(actorIdentityCache, { ...identity, lastSeenAtMs: Date.now() });
    actorIdentityPersistence.schedule(actorIdentityCache);
  },
  onBossGravestone: (gravestone) => bossTimers.recordGravestone(gravestone),
  onServerInstance: (instanceId) => bossTimers.setCurrentInstance(instanceId),
  onSessionEnded: finalizeSessionSummaries,
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
    setLanguage: ({ language }: { language: LocaleCode }) => setLanguage(language),
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
      openSettings: ({ section }) => { openSettings(section); },
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

type OverlayWindowHandle = Awaited<ReturnType<typeof createOverlayWindow>>;

/** Every overlay settings mutation runs against the window, then republishes the merged settings state. */
function overlayAction<P = void>(apply: (overlay: OverlayWindowHandle, params: P) => unknown) {
  return async (params: P): Promise<SharedSettingsState> => {
    await overlayWindow.withWindow((overlay) => apply(overlay, params));
    return sharedSettingsState();
  };
}

const settingsRpc = BrowserView.defineRPC<LauncherSettingsRpc>({
  maxRequestTime: 30_000,
  handlers: {
    requests: {
      getState: async () => {
        const state = await sharedSettingsState();
        flushPendingSettingsSection();
        return state;
      },
      setCaptureAdapter: async ({ deviceName }) => {
        await setCaptureAdapter(deviceName);
        return sharedSettingsState();
      },
      setUiScale: async ({ uiScale }) => {
        await setLauncherUiScale(uiScale);
        return sharedSettingsState();
      },
      setLanguage: async ({ language }) => {
        setLanguage(language);
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
      setPastLogLimit: async ({ pastLogLimit }) => {
        setPastLogLimit(pastLogLimit);
        return sharedSettingsState();
      },
      refreshCaptureDevices: async () => {
        await refreshCaptureDevices();
        if (launcherState.npcapAvailability === "ready" && capture.state().captureStatus !== "capturing") await capture.start();
        return sharedSettingsState();
      },
      openNpcapDownload: () => { Utils.openExternal("https://npcap.com/#download"); },
      setOverlayLocked: overlayAction((o, { locked }: { locked: boolean }) => o.setLocked(locked)),
      setOverlayElementEnabled: overlayAction((o, { id, enabled }: { id: OverlayElementId; enabled: boolean }) => o.setElementEnabled(id, enabled)),
      setOverlayElementDisplay: overlayAction((o, { id, display }: { id: OverlayElementId; display: string }) => o.setElementDisplay(id, display)),
      setOverlayHomeDisplay: overlayAction((o, { display }: { display: string }) => o.setHomeDisplay(display)),
      setOverlayVisible: overlayAction((o, { visible }: { visible: boolean }) => o.setOverlayVisible(visible)),
      setAutoHideWhenUnfocused: overlayAction((o, { enabled }: { enabled: boolean }) => o.setAutoHideWhenUnfocused(enabled)),
      setShortcut: overlayAction((o, { action, shortcut }: { action: KeybindAction; shortcut: string }) => o.setShortcut(action, shortcut)),
      resetShortcutsToDefaults: overlayAction((o) => o.resetShortcutsToDefaults()),
      setShortcutCapture: overlayAction((o, { active }: { active: boolean }) => o.setShortcutCapture(active)),
      setOverlayRequiredStatuses: overlayAction((o, { category, statusIds }: { category: RequiredStatusCategory; statusIds: string[] }) => o.setRequiredStatuses(category, statusIds)),
      setPersonalDpsMode: overlayAction((o, { mode }: { mode: PersonalDpsMode }) => o.setPersonalDpsMode(mode)),
      setMinimapEnabled: overlayAction((o, { enabled }: { enabled: boolean }) => o.setMinimapEnabled(enabled)),
      setMinimapRarityFilter: overlayAction((o, { rarity }: { rarity: number }) => o.setMinimapRarityFilter(rarity)),
      setMinimapLootChanceFilter: overlayAction((o, { chance }: { chance: number }) => o.setMinimapLootChanceFilter(chance)),
      importSettings: () => importSettingsAndClose(),
      importSetting: ({ kind }) => importSingleSettingAndClose(kind),
      exportSetting: ({ kind }) => exportSettingAndNotify(kind),
      openDataFolder: () => { openSettingsDataFolder(); },
      resetSettings: () => resetSettingsAndClose(),
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
  title: translate("app.name"),
  url: "views://launcherview/index.html",
  frame: placements.frame("launcher", { x: 80, y: 80, width: 960, height: 430 }, { width: 900, height: 430 }),
  titleBarStyle: "hidden",
  transparent: false,
  // Neutralino restores its own state for the root window; pushing ours makes windows.json
  // authoritative. A first run has no saved frame, so the window stays where the OS put it.
  restoreFrameOnAttach: placements.has("launcher"),
  rpc,
});
applyRoundedCorners(launcherWindow.ptr);
setWindowIcon(launcherWindow.ptr, appIconPath);
launcherLifecycle.add(registerUiScaleWindow(launcherWindow, { scaleInitialFrame: false }));
launcherLifecycle.add(registerLocaleWindow(launcherWindow));
launcherLifecycle.add(placements.track("launcher", launcherWindow));

const tray = new Tray({
  title: translate("app.name"),
  image: "views://assets/app-icon.ico",
  width: 32,
  height: 32,
});
// Tray labels are set once, so a language change has to lay the menu down again.
function refreshTrayMenu(): void {
  tray.setMenu([
    { type: "normal", label: translate("tray.showLauncher"), action: "show-launcher" },
    { type: "normal", label: translate("tray.openCombat"), action: "open-combat" },
    { type: "normal", label: translate("tray.openOverlay"), action: "open-overlay" },
    { type: "normal", label: translate("tray.openRewards"), action: "open-rewards" },
    { type: "divider" },
    { type: "normal", label: translate("tray.exit"), action: "exit" },
  ]);
}
refreshTrayMenu();
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
void measureLogUsage().catch((error) => {
  errorLog.write({ title: "Log storage could not be measured", reason: error instanceof Error ? error.message : String(error) });
});
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
      reason: englishText(launcherState.npcapDetail),
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
        npcapDetail: message("common.passthrough", { text: status.detail }),
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
      npcapDetail: message("common.passthrough", { text: status.detail }),
      ...(status.version ? { npcapVersion: status.version } : {}),
      selectedAdapter: settings.captureAdapter,
      effectiveAdapter: resolved.device?.name,
      adapterFallback: resolved.usedFallback,
      adapters: devices.map((device) => ({ id: device.name, label: device.description })),
    };
  } catch (error) {
    const failureMessage = error instanceof Error ? error.message : String(error);
    errorLog.write({ title: "Network adapters could not be inspected", reason: failureMessage });
    launcherState = {
      ...launcherState,
      npcapAvailability: "error",
      npcapDetail: message("common.passthrough", { text: failureMessage }),
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

/** Every manage-settings dialog is a single-OK box under the same title; `body` selects the message. */
function notifyManageSettings(body: MessageKey, type: "info" | "warning" = "info"): Promise<unknown> {
  return Utils.showMessageBox({
    type,
    title: translate("dialog.manageSettings.title"),
    message: translate(body),
    buttons: [translate("common.ok")],
    defaultId: 0,
    cancelId: 0,
  });
}

/** Import/reset flows close every window, apply the change on disk, confirm, then quit so the next launch adopts it. */
async function applyAndRestart(mutate: () => Promise<void>, confirm: MessageKey): Promise<void> {
  try {
    await closeAllWindowsAndFlush();
    await mutate();
    await notifyManageSettings(confirm);
  } finally {
    await quitImmediately();
  }
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
    await notifyManageSettings("dialog.manageSettings.sameFolder");
    return;
  }
  if (plan.status === "not-found") {
    await notifyManageSettings("dialog.manageSettings.notFound", "warning");
    return;
  }
  await applyAndRestart(() => applyImport(plan.oldPaths, storagePaths, readDisplays()), "dialog.manageSettings.imported");
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
  await applyAndRestart(() => importSingleSetting(kind, selected, storagePaths, readDisplays()), "dialog.manageSettings.imported");
}

async function exportSettingAndNotify(kind: SettingsKind): Promise<void> {
  const destination = await Utils.showSaveDialog({
    defaultPath: path.join(localRoot, settingsKindFileName(kind)),
    filters: ["json"],
  });
  if (!destination) return;
  await exportSingleSetting(kind, storagePaths, destination, readDisplays());
  await notifyManageSettings("dialog.manageSettings.exported");
}

function openSettingsDataFolder(): void {
  Utils.showItemInFolder(storagePaths.launcherSettingsPath);
}

async function resetSettingsAndClose(): Promise<void> {
  await applyAndRestart(async () => {
    await resetAllSettings(storagePaths, readDisplays());
  }, "dialog.manageSettings.reset");
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

function flushPendingSettingsSection(): void {
  const section = pendingSettingsSection;
  if (!section) return;
  // Stay pending when the send fails; the view's getState retries once it connects.
  try { settingsRpc.send.showSection(section); } catch { return; }
  pendingSettingsSection = undefined;
}

function openSettings(section?: SettingsSectionId): void {
  pendingSettingsSection = section;
  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.activate();
    flushPendingSettingsSection();
    return;
  }
  const nextWindow = new BrowserWindow({
    title: translate("settings.window.title"),
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
  lifecycle.add(registerLocaleWindow(nextWindow));
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

/** Persist one launcher setting, mirror it into the published state under the same key, and republish. */
function applySetting<K extends keyof LauncherSettings & keyof LauncherState>(
  key: K,
  value: LauncherSettings[K] & LauncherState[K],
): LauncherState {
  settings[key] = value;
  launcherState = { ...launcherState, [key]: value };
  launcherSettingsPersistence.schedule(settings);
  publish();
  return launcherState;
}

async function setLauncherUiScale(uiScale: typeof settings.uiScale): Promise<LauncherState> {
  return applySetting("uiScale", setUiScale(uiScale));
}

function setLanguage(language: LocaleCode): LauncherState {
  setActiveLocale(language);
  refreshTrayMenu();
  return applySetting("language", language);
}

function setMinimizeToTray(minimizeToTray: boolean): LauncherState {
  return applySetting("minimizeToTray", minimizeToTray);
}

function setResetMeterOnMapChange(resetMeterOnMapChange: boolean): LauncherState {
  return applySetting("resetMeterOnMapChange", resetMeterOnMapChange);
}

function setResetGoldOnMapChange(resetGoldOnMapChange: boolean): LauncherState {
  return applySetting("resetGoldOnMapChange", resetGoldOnMapChange);
}

function setPastLogLimit(pastLogLimit: number): LauncherState {
  return applySetting("pastLogLimit", normalizeHistorySessionLimit(pastLogLimit));
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

async function sharedSettingsState(): Promise<SharedSettingsState> {
  const overlay = await overlayWindow.withWindow((managed) => managed.getSettingsState());
  return { launcher: launcherState, overlay, dataFolder: path.dirname(storagePaths.launcherSettingsPath) };
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

async function publishSettings(overlayState?: SharedSettingsState["overlay"]): Promise<void> {
  if (!settingsWindow) return;
  try {
    settingsRpc.send.stateChanged(overlayState
      ? { launcher: launcherState, overlay: overlayState, dataFolder: path.dirname(storagePaths.launcherSettingsPath) }
      : await sharedSettingsState());
  } catch { /* Settings may be connecting or closing. */ }
}

async function finalizeSessionSummaries(sessionId: string): Promise<void> {
  const journal = await sessionSummaryJournal();
  const results = await Promise.allSettled([
    (async () => {
      const sourcePath = streamSessionPath("combat", sessionId, logDirectory);
      const result = {
        ...await inspectCombatReplaySummary(sourcePath),
        locations: await readCombatLocations(sourcePath),
      };
      await journal.append(sessionId, "combat", result);
    })(),
    (async () => {
      const sourcePath = streamSessionPath("rewards", sessionId, logDirectory);
      await journal.append(sessionId, "rewards", await inspectRewardsReplaySummary(sourcePath));
    })(),
  ]);
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") continue;
    const stream = index === 0 ? "combat" : "rewards";
    errorLog.write({
      title: `${stream} session summary could not be saved`,
      reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
      details: { "Session ID": sessionId, "Log directory": logDirectory },
    });
  }
}

function sessionSummaryJournal(): ReturnType<typeof loadSessionSummaryJournal> {
  summaryJournalPromise ??= loadSessionSummaryJournal(logDirectory);
  return summaryJournalPromise;
}

async function closeAllWindowsAndFlush(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  placements.remember("launcher", launcherWindow.getFrame());
  launcherLifecycle.dispose();
  settingsLifecycle?.dispose();
  settingsLifecycle = undefined;
  launcherWindow.hide();
  settingsWindow?.close();
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
