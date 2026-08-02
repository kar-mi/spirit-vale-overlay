import path from "node:path";
import { stat } from "node:fs/promises";

import { BrowserView, BrowserWindow, Utils } from "electrobun/bun";
import { applyRoundedCorners, setWindowIcon } from "@spiritvale/ui-core/win32";
import { appIconPath } from "@spiritvale/ui-core/window-publish";

import {
  DpsLogFollower,
  DpsSessionLogFollower,
  inspectCombatReplaySummary,
  LiveCombatService,
} from "@kar-mi/spirit-vale-tools-combat";
import type { CharacterViewState } from "@kar-mi/spirit-vale-tools-character";
import { listLogSessions } from "@kar-mi/spirit-vale-tools-logging";
import type { CombatEncounterRecord } from "@kar-mi/spirit-vale-tools-combat";
import { loadDpsAppSettings, saveDpsAppSettings } from "../settings.ts";
import type { CombatLogScreen, DpsAppRpc, DpsAppState, DpsAppStatus } from "../app-types.ts";
import { SafeSaveQueue } from "@spiritvale/ui-core/safe-save";
import { createCombatAnalysisController } from "./combat-analysis-window.ts";
import { registerUiScaleWindow, scaledSize, unscaledSize } from "@spiritvale/ui-core/ui-scale-window";
import { visibleScaledWindowFrame, type WindowPlacementStore } from "@spiritvale/ui-core/window-placement";
import { DPS_WINDOW_MINIMUM_HEIGHT, DPS_WINDOW_MINIMUM_WIDTH } from "../window-size.ts";
import { loadSessionSummaryCache, type SessionSummaryCache } from "@spiritvale/ui-core/session-summary-cache";
import type { SessionPickerState } from "@spiritvale/ui-core/session-picker-types";
import { activeDeathLogSource } from "../combat-navigation.ts";
import { DisposableStore, onWindowEvent, onceWindowEvent } from "@spiritvale/ui-core/window-lifecycle";
import { detectedPersonalName } from "../personal-character.ts";
import type { CombatReadModelSource } from "../combat-history.ts";

const MINIMUM_WIDTH = DPS_WINDOW_MINIMUM_WIDTH;
const MINIMUM_HEIGHT = DPS_WINDOW_MINIMUM_HEIGHT;
const LIVE_LOG_POLL_MS = 1_000;
const MAX_RECENT_SESSIONS = 100;
/** Timeline buckets retained per encounter. Beyond this, adjacent buckets merge. */
const TIMELINE_POINTS = 720;
export interface DpsWindowOptions {
  logDirectory: string;
  /** Past analysis and the death log read managed session logs from here when it is available. */
  readModel?: CombatReadModelSource;
  getCharacterState: () => CharacterViewState;
  subscribeCharacter: (listener: (state: CharacterViewState) => void) => () => void;
  settingsPath?: string;
  placements?: WindowPlacementStore;
  onClosed?: () => void;
  onReset?: () => Promise<void>;
  onOpenSettings?: () => void;
  onOpenLiveDeathLog?: () => Promise<void> | void;
}

export async function createDpsWindow(options: DpsWindowOptions) {
const liveLogOverride = process.env.SPIRIT_VALE_COMBAT_LOG;
const settings = await loadDpsAppSettings(options.settingsPath);
const initialCharacterState = options.getCharacterState();
let personalName = detectedPersonalName(initialCharacterState);

let window: BrowserWindow;
let status: DpsAppStatus = "waiting";
let statusDetail = liveLogOverride ? `Looking for ${path.basename(liveLogOverride)}…` : "Looking for a combat session…";
// Declared before the meter: createLiveMeter() reads it, and a `let` referenced before its
// declaration throws rather than reading undefined.
let manualPersonalActorId: number | undefined;
// One service aggregates DPS, TPS and HPS from the same events. It retains bounded per-encounter
// buckets and the latest finished encounter, never individual hits or the whole session.
let liveMeter = createLiveMeter();
const liveLog = liveLogOverride ? new DpsLogFollower(liveLogOverride) : new DpsSessionLogFollower(options.logDirectory);
let liveLogPolling = false;
let publishing = false;
let shuttingDown = false;
let storageWarning: string | undefined;
let resetting = false;
let lastEventObservedAtMs: number | undefined;
let lastEventWallMs: number | undefined;
let currentLiveLogPath: string | undefined;
let screen: CombatLogScreen = "live";
let past: DpsAppState["past"] = { view: "selector", picker: pastPickerLoadingState() };
let pastPaths = new Map<string, string>();
let pastRefreshSequence = 0;
let pastSummaryCachePromise: Promise<SessionSummaryCache> | undefined;
const lifecycle = new DisposableStore();

const settingsPersistence = new SafeSaveQueue<typeof settings>({
  label: "DPS settings",
  save: (value) => saveDpsAppSettings(value, options.settingsPath),
  onWarning: (warning) => { storageWarning = warning; publish(); },
});

const analysis = createCombatAnalysisController({
  logDirectory: options.logDirectory,
  ...(options.readModel === undefined ? {} : { readModel: options.readModel }),
  placements: options.placements,
  onOpenSettings: options.onOpenSettings,
  onStateChanged: (nextAnalysis) => {
    if (past.view !== "analysis") return;
    past = { view: "analysis", analysis: nextAnalysis };
    publish();
  },
});

const rpc = BrowserView.defineRPC<DpsAppRpc>({
  maxRequestTime: 30_000,
  handlers: {
    requests: {
      getState: () => appState(),
      setScreen: ({ screen: nextScreen }) => {
        setScreen(nextScreen);
        return appState();
      },
      refreshPastSessions: () => { void refreshPastSessions(); },
      openPastSession: ({ id }) => {
        const selectedPath = pastPaths.get(id);
        if (selectedPath) void openPastPath(selectedPath);
      },
      choosePastFile: () => { void choosePastFile(); },
      openPastLogFolder: () => { void Utils.openPath(options.logDirectory); },
      backToPastSessions: () => {
        analysis.close();
        past = { view: "selector", picker: pastPickerLoadingState() };
        publish();
        void refreshPastSessions();
        return appState();
      },
      selectPastEncounter: ({ id }) => {
        analysis.selectEncounter(id);
        return appState();
      },
      setPastStatType: ({ statType }) => {
        analysis.setStatType(statType);
        return appState();
      },
      openPlayerDetails: ({ source, actorId, selectedEnemyIds }) => {
        if (source === "past") {
          if (screen === "past" && past.view === "analysis") analysis.openPlayerDetails(actorId, selectedEnemyIds);
          return;
        }
        if (screen !== "live") return;
        const live = liveSnapshots();
        if (!currentLiveLogPath || !live.snapshot) return;
        analysis.openLivePlayerDetails({
          actorId,
          fileName: path.basename(currentLiveLogPath),
          ...live,
          statType: settings.statType,
        });
      },
      openActiveDeathLog: async () => {
        const source = activeDeathLogSource(screen, past.view, currentLiveLogPath !== undefined);
        if (source === "live") await options.onOpenLiveDeathLog?.();
        else if (source === "past") await analysis.openDeathLog();
      },
      openSettings: () => { options.onOpenSettings?.(); },
      resetSession: async () => {
        if (!resetting && options.onReset) {
          resetting = true;
          analysis.closeDetails();
          publish();
          try {
            await options.onReset();
            liveMeter = createLiveMeter();
            lastEventObservedAtMs = undefined;
            lastEventWallMs = undefined;
          } catch {
            // Keep the existing meter/UI data unchanged when rotation fails.
          } finally {
            resetting = false;
          }
        }
        publish();
        return appState();
      },
      setPersonalActor: ({ actorId }) => {
        manualPersonalActorId = actorId ?? undefined;
        liveMeter.setPersonalActorId(manualPersonalActorId);
        publish();
        return appState();
      },
      setTab: ({ tab }) => {
        settings.tab = tab;
        scheduleSettingsSave();
        publish();
        return appState();
      },
      setStatType: ({ statType }) => {
        settings.statType = statType;
        scheduleSettingsSave();
        publish();
        return appState();
      },
      windowAction: async ({ action }) => {
        if (action === "minimize") {
          window.minimize();
          return;
        }
        await shutdown();
        window.close();
      },
      getWindowFrame: () => window.getFrame(),
      setWindowFrame: ({ x, y, width, height }) => { window.setFrame(x, y, width, height); },
    },
    messages: {},
  },
});

window = new BrowserWindow({
  title: "Spirit Vale DPS",
  url: "views://mainview/index.html",
  frame: visibleScaledWindowFrame(settings.frame, { width: MINIMUM_WIDTH, height: MINIMUM_HEIGHT }),
  titleBarStyle: "hidden",
  transparent: false,
  rpc,
});
applyRoundedCorners(window.ptr);
setWindowIcon(window.ptr, appIconPath);
lifecycle.add(registerUiScaleWindow(window, { scaleInitialFrame: false }));

lifecycle.add(onWindowEvent(window, "move", (event: { data: typeof settings.frame }) => {
  if (window.isMaximized()) return;
  settings.frame = unscaleFrame(clampPhysicalFrame(event.data));
  scheduleSettingsSave();
}));
lifecycle.add(onWindowEvent(window, "resize", (event: { data: typeof settings.frame }) => {
  if (window.isMaximized()) return;
  const frame = clampPhysicalFrame(event.data);
  settings.frame = unscaleFrame(frame);
  if (event.data.width < scaledSize(MINIMUM_WIDTH) || event.data.height < scaledSize(MINIMUM_HEIGHT)) {
    window.setSize(frame.width, frame.height);
  }
  scheduleSettingsSave();
}));
lifecycle.add(onceWindowEvent(window, "close", () => {
  void shutdown();
  options.onClosed?.();
}));

const liveLogTimer = setInterval(() => void pollLiveLog(), LIVE_LOG_POLL_MS);
const unsubscribeCharacter = options.subscribeCharacter(syncDetectedCharacter);
void pollLiveLog();
return {
  show: () => window.show(),
  activate: () => window.activate(),
  // No onClosed here: Electrobun fires the native close event on a programmatic close too, and the
  // close handler above is authoritative. Calling it from both paths ran it twice.
  close: async () => { await shutdown(); window.close(); },
};

function appState(): DpsAppState {
  const { snapshot, tankedSnapshot, healSnapshot } = liveSnapshots();
  return {
    screen,
    tab: settings.tab,
    statType: settings.statType,
    status,
    statusDetail,
    ...(storageWarning ? { storageWarning } : {}),
    personalName,
    ...(liveMeter.getPersonalActorId() === undefined ? {} : { personalActorId: liveMeter.getPersonalActorId() }),
    ...(snapshot ? { snapshot } : {}),
    ...(tankedSnapshot ? { tankedSnapshot } : {}),
    ...(healSnapshot ? { healSnapshot } : {}),
    resetting,
    liveDeathLogAvailable: currentLiveLogPath !== undefined,
    past,
  };
}

function publish(): void {
  if (publishing || !window) return;
  publishing = true;
  try {
    if (screen === "live" && currentLiveLogPath) {
      analysis.refreshLivePlayerDetails({
        fileName: path.basename(currentLiveLogPath),
        ...liveSnapshots(),
        statType: settings.statType,
      });
    }
    rpc.send.stateChanged(appState());
  } catch {
    // The webview may not have completed its RPC handshake yet.
  } finally {
    publishing = false;
  }
}

async function pollLiveLog(): Promise<void> {
  if (liveLogPolling || shuttingDown) return;
  liveLogPolling = true;
  try {
    const batch = await liveLog.poll();
    currentLiveLogPath = batch.path ?? liveLogOverride ?? currentLiveLogPath;
    if (batch.reset) {
      liveMeter = createLiveMeter();
      lastEventObservedAtMs = undefined;
      lastEventWallMs = undefined;
    }
    let batchLastObservedAtMs: number | undefined;
    for (const { event, observedAtMs } of batch.events) {
      if (event.kind === "actorIdentity") liveMeter.consumeIdentity(event, observedAtMs);
      else liveMeter.consumeCombat(event, observedAtMs);
      batchLastObservedAtMs = Math.max(batchLastObservedAtMs ?? observedAtMs, observedAtMs);
    }
    if (batchLastObservedAtMs !== undefined) {
      lastEventObservedAtMs = batchLastObservedAtMs;
      lastEventWallMs = Date.now();
    }
    const nowMs = relativeNowMs();
    if (nowMs !== undefined) liveMeter.advance(nowMs);
    const fileName = path.basename(batch.path ?? liveLogOverride ?? "combat.jsonl");
    if (batch.missing) updateLiveStatus("waiting", `Waiting for ${fileName}`);
    else if (batch.invalidLines > 0) updateLiveStatus("ready", `Reading ${fileName} with skipped lines`);
    else if (batch.events.length > 0) updateLiveStatus("capturing", `Reading ${fileName}`);
    else updateLiveStatus(latestRecord() ? "ready" : "waiting", `Watching ${fileName}`);
  } catch {
    updateLiveStatus("error", `Could not read ${path.basename(liveLogOverride ?? "combat.jsonl")}`);
  } finally {
    liveLogPolling = false;
  }
}

function relativeNowMs(): number | undefined {
  if (lastEventObservedAtMs === undefined || lastEventWallMs === undefined) return undefined;
  return lastEventObservedAtMs + (Date.now() - lastEventWallMs);
}

function syncDetectedCharacter(characterState: CharacterViewState): void {
  const nextPersonalName = detectedPersonalName(characterState);
  if (nextPersonalName === personalName) return;
  personalName = nextPersonalName;
  liveMeter.setPersonalName(personalName);
  if (manualPersonalActorId !== undefined) {
    manualPersonalActorId = undefined;
    liveMeter.setPersonalActorId(undefined);
  }
  publish();
}

function createLiveMeter(): LiveCombatService {
  return new LiveCombatService({
    personalName,
    timelinePoints: TIMELINE_POINTS,
    ...(manualPersonalActorId === undefined ? {} : { personalActorId: manualPersonalActorId }),
  });
}

/** The encounter in progress, or the most recent one once it has ended. */
function latestRecord(): CombatEncounterRecord | undefined {
  const state = liveMeter.getState(relativeNowMs());
  return state.current ?? state.latestFinished;
}

function liveSnapshots(): Pick<DpsAppState, "snapshot" | "tankedSnapshot" | "healSnapshot"> {
  const record = latestRecord();
  if (!record) return {};
  return { snapshot: record.dps, tankedSnapshot: record.tps.detail, healSnapshot: record.hps.detail };
}

function setScreen(nextScreen: CombatLogScreen): void {
  if (screen === nextScreen) return;
  screen = nextScreen;
  analysis.closeDetails();
  if (nextScreen === "live") {
    pastRefreshSequence += 1;
    analysis.close();
    pastPaths.clear();
    past = { view: "selector", picker: pastPickerLoadingState() };
    publish();
    return;
  }
  past = { view: "selector", picker: pastPickerLoadingState() };
  publish();
  void refreshPastSessions();
}

function pastSummaryCache(): Promise<SessionSummaryCache> {
  const cache = pastSummaryCachePromise ?? loadSessionSummaryCache(
    path.join(options.logDirectory, "cache", "combat-summary-cache.json"),
  );
  pastSummaryCachePromise = cache;
  return cache;
}

async function refreshPastSessions(): Promise<void> {
  if (screen !== "past" || past.view !== "selector") return;
  const sequence = ++pastRefreshSequence;
  past = { view: "selector", picker: pastPickerLoadingState() };
  publish();
  try {
    const cache = await pastSummaryCache();
    const sessions = await listLogSessions("combat", options.logDirectory, MAX_RECENT_SESSIONS);
    const nextPaths = new Map<string, string>();
    const items: SessionPickerState["sessions"] = [];
    for (let offset = 0; offset < sessions.length && items.length < MAX_RECENT_SESSIONS; offset += 10) {
      const inspected = await Promise.all(sessions.slice(offset, offset + 10).map(async (session) => {
        try {
          const info = await stat(session.path);
          const cached = cache.get(session.path, info);
          const result = cached ?? await inspectCombatReplaySummary(session.path);
          if (!cached) cache.set(session.path, info, result);
          if (result.recordCount === 0) return undefined;
          nextPaths.set(session.id, session.path);
          return {
            id: session.id,
            createdAt: session.createdAt,
            summary: result.summary,
            active: session.active,
            disabled: false,
          };
        } catch {
          return {
            id: session.id,
            createdAt: session.createdAt,
            summary: "Summary unavailable",
            active: session.active,
            disabled: true,
          };
        }
      }));
      for (const item of inspected) {
        if (item && items.length < MAX_RECENT_SESSIONS) items.push(item);
      }
      if (sequence !== pastRefreshSequence || screen !== "past" || past.view !== "selector") return;
      pastPaths = nextPaths;
      past = {
        view: "selector",
        picker: {
          title: "Past combat logs",
          status: "loading",
          statusDetail: `Scanning… ${items.length} session${items.length === 1 ? "" : "s"} found so far`,
          sessions: items.slice(),
          canOpenLogFolder: true,
        },
      };
      publish();
    }
    if (sequence !== pastRefreshSequence || screen !== "past" || past.view !== "selector") return;
    pastPaths = nextPaths;
    past = {
      view: "selector",
      picker: {
        title: "Past combat logs",
        status: "ready",
        statusDetail: items.length === 0 ? "No managed sessions found." : `${items.length} recent session${items.length === 1 ? "" : "s"}`,
        sessions: items,
        canOpenLogFolder: true,
      },
    };
    publish();
    try {
      cache.prune(new Set(sessions.map((session) => path.resolve(session.path))));
      await cache.save();
    } catch {
      // Fresh results remain usable if the optional summary cache cannot be saved.
    }
  } catch {
    if (sequence !== pastRefreshSequence || screen !== "past" || past.view !== "selector") return;
    pastPaths.clear();
    past = {
      view: "selector",
      picker: {
        title: "Past combat logs",
        status: "error",
        statusDetail: "Recent sessions could not be scanned.",
        sessions: [],
        canOpenLogFolder: true,
      },
    };
    publish();
  }
}

async function choosePastFile(): Promise<void> {
  const [selectedPath] = await Utils.openFileDialog({
    startingFolder: Utils.paths.documents,
    allowedFileTypes: "jsonl",
    canChooseFiles: true,
    canChooseDirectory: false,
    allowsMultipleSelection: false,
  });
  if (selectedPath) await openPastPath(path.resolve(selectedPath));
}

async function openPastPath(selectedPath: string): Promise<void> {
  if (screen !== "past") return;
  pastRefreshSequence += 1;
  const opening = analysis.open(selectedPath);
  past = { view: "analysis", analysis: analysis.getState() };
  publish();
  try {
    await opening;
  } catch {
    // The controller publishes its readable error state; Back remains available.
  }
}

function pastPickerLoadingState(): SessionPickerState {
  return {
    title: "Past combat logs",
    status: "loading",
    statusDetail: "Scanning recent sessions…",
    sessions: [],
    canOpenLogFolder: true,
  };
}

function updateLiveStatus(nextStatus: DpsAppStatus, detail: string): void {
  status = nextStatus;
  statusDetail = detail;
  publish();
}

function clampFrame(frame: DpsAppSettingsFrame): DpsAppSettingsFrame {
  return {
    x: frame.x,
    y: frame.y,
    width: Math.max(MINIMUM_WIDTH, frame.width),
    height: Math.max(MINIMUM_HEIGHT, frame.height),
  };
}

function unscaleFrame(frame: DpsAppSettingsFrame): DpsAppSettingsFrame {
  return clampFrame({ x: frame.x, y: frame.y, width: unscaledSize(frame.width), height: unscaledSize(frame.height) });
}

function clampPhysicalFrame(frame: DpsAppSettingsFrame): DpsAppSettingsFrame {
  return { x: frame.x, y: frame.y, width: Math.max(scaledSize(MINIMUM_WIDTH), frame.width), height: Math.max(scaledSize(MINIMUM_HEIGHT), frame.height) };
}

type DpsAppSettingsFrame = typeof settings.frame;

function scheduleSettingsSave(): void {
  settingsPersistence.schedule(settings);
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  lifecycle.dispose();
  analysis.close();
  unsubscribeCharacter();
  if (!window.isMaximized()) settings.frame = unscaleFrame(window.getFrame());
  clearInterval(liveLogTimer);
  await settingsPersistence.flush(settings);
}
}
