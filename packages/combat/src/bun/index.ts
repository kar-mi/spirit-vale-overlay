import path from "node:path";
import { stat } from "node:fs/promises";

import { BrowserView, BrowserWindow, Utils } from "electrobun/bun";
import { applyRoundedCorners, setWindowIcon } from "@svoverlay/desktop-platform/win32";
import { appIconPath } from "@svoverlay/desktop-platform/window-publish";

import {
  DpsLogFollower,
  DpsSessionLogFollower,
  inspectCombatReplaySummary,
  LiveCombatService,
} from "@kar-mi/spirit-vale-tools-combat";
import type { CharacterViewState } from "@kar-mi/spirit-vale-tools-character";
import { listLogSessions } from "@kar-mi/spirit-vale-tools-logging";
import type { CombatEncounterRecord, DpsLogBatch } from "@kar-mi/spirit-vale-tools-combat";
import { loadDpsAppSettings, saveDpsAppSettings } from "../settings.ts";
import type { CombatLogScreen, DpsAppRpc, DpsAppState, DpsAppStatus } from "../app-types.ts";
import { SafeSaveQueue } from "@svoverlay/desktop-platform/safe-save";
import { createCombatAnalysisController } from "./combat-analysis-window.ts";
import { registerUiScaleWindow, scaledSize, unscaledSize } from "@svoverlay/desktop-platform/ui-scale-window";
import { visibleScaledWindowFrame, type WindowPlacementStore } from "@svoverlay/desktop-platform/window-placement";
import { DPS_WINDOW_MINIMUM_HEIGHT, DPS_WINDOW_MINIMUM_WIDTH } from "../window-size.ts";
import { loadSessionSummaryCache, type SessionSummaryCache } from "@svoverlay/desktop-platform/session-summary-cache";
import type { SessionPickerState } from "@svoverlay/desktop-platform/session-picker-types";
import { activeDeathLogSource } from "../combat-navigation.ts";
import { DisposableStore, onWindowEvent, onceWindowEvent } from "@svoverlay/desktop-platform/window-lifecycle";
import { detectedPersonalName } from "../personal-character.ts";
import type { CombatReadModelSource } from "../combat-history.ts";
import { locationFromLogData, readCombatLocations } from "../zone-log.ts";
import type { SpiritValeLocation } from "@svoverlay/desktop-platform/location";

const MINIMUM_WIDTH = DPS_WINDOW_MINIMUM_WIDTH;
const MINIMUM_HEIGHT = DPS_WINDOW_MINIMUM_HEIGHT;
/**
 * Tail interval for the `SPIRIT_VALE_COMBAT_LOG` override only.
 *
 * The shipped path is watcher-driven. `DpsLogFollower` tails one fixed file and exposes no watcher,
 * so that development aid keeps a clock of its own.
 */
const LIVE_LOG_OVERRIDE_POLL_MS = 1_000;
/**
 * How often an open encounter is redrawn while no events are arriving.
 *
 * The DPS figures decay between hits and the idle gap that closes an encounter is measured in wall
 * time, so an open encounter needs a beat of its own. Nothing is scheduled once it closes.
 */
const LIVE_METER_TICK_MS = 1_000;
const MAX_RECENT_SESSIONS = 100;
/**
 * Sessions inspected while filling the list. Empty sessions are skipped, so the scan has to reach
 * past MAX_RECENT_SESSIONS to still show that many — bounded so a directory full of empty sessions
 * cannot turn one refresh into an unbounded summarize pass.
 */
const MAX_SCANNED_SESSIONS = MAX_RECENT_SESSIONS * 3;
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
const liveLog = createLiveLogSource();
let liveMeterTimer: ReturnType<typeof setTimeout> | undefined;
/** Wall clock of the last publish driven by the live log, which the floor below is measured from. */
let lastLivePublishMs = Number.NEGATIVE_INFINITY;
let publishing = false;
let shuttingDown = false;
let closedCallbackSent = false;
let storageWarning: string | undefined;
let resetting = false;
let lastEventObservedAtMs: number | undefined;
let lastEventWallMs: number | undefined;
let currentLiveLogPath: string | undefined;
let currentLiveLocation: SpiritValeLocation | undefined;
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
      openPlayerDetails: (request) => {
        const { source, selectedEnemyIds } = request;
        if (source === "past") {
          if (screen === "past" && past.view === "analysis") analysis.openPlayerDetails(request.rowId, selectedEnemyIds);
          return;
        }
        if (screen !== "live") return;
        const live = liveSnapshots();
        if (!currentLiveLogPath || !live.snapshot) return;
        analysis.openLivePlayerDetails({
          actorId: request.actorId,
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
            currentLiveLocation = undefined;
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
lifecycle.add(onceWindowEvent(window, "close", () => { void shutdown(); }));

const unsubscribeCharacter = options.subscribeCharacter(syncDetectedCharacter);
void followLiveLog();
return {
  show: () => window.show(),
  activate: () => window.activate(),
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
    ...(currentLiveLocation === undefined ? {} : { location: currentLiveLocation }),
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

/**
 * The combat log as this window consumes it.
 *
 * The shipped path hands off to the session follower's watcher, which only settles when there is
 * something to read. The `SPIRIT_VALE_COMBAT_LOG` override has no watcher behind it, so it keeps a
 * clock of its own.
 */
interface LiveLogSource {
  next(): Promise<DpsLogBatch>;
  close(): void;
}

function createLiveLogSource(): LiveLogSource {
  if (liveLogOverride === undefined) {
    const follower = new DpsSessionLogFollower(options.logDirectory);
    return { next: () => follower.next(), close: () => follower.close() };
  }
  const follower = new DpsLogFollower(liveLogOverride);
  return {
    next: async () => {
      await new Promise((resolve) => setTimeout(resolve, LIVE_LOG_OVERRIDE_POLL_MS));
      return follower.poll();
    },
    close: () => {},
  };
}

/**
 * Consumes the log for as long as the window is open.
 *
 * `close()` settles a parked `next()`, so shutdown unwinds this rather than leaving it hanging.
 */
async function followLiveLog(): Promise<void> {
  while (!shuttingDown) {
    let batch: DpsLogBatch;
    try {
      batch = await liveLog.next();
    } catch {
      updateLiveStatus("error", `Could not read ${path.basename(liveLogOverride ?? "combat.jsonl")}`);
      // Back off rather than spinning: whatever failed will not be fixed by retrying at once.
      await new Promise((resolve) => setTimeout(resolve, LIVE_LOG_OVERRIDE_POLL_MS));
      continue;
    }
    if (shuttingDown) return;
    applyLiveLogBatch(batch);
  }
}

function applyLiveLogBatch(batch: DpsLogBatch): void {
  // An unchanged batch carries no events and no session change, so there is nothing to fold in and
  // nothing that could have moved the meter.
  if (!batch.changed) return;
  currentLiveLogPath = batch.path ?? liveLogOverride ?? currentLiveLogPath;
  if (batch.reset) {
    liveMeter = createLiveMeter();
    lastEventObservedAtMs = undefined;
    lastEventWallMs = undefined;
    currentLiveLocation = undefined;
  }
  let batchLastObservedAtMs: number | undefined;
  for (const { event, observedAtMs } of batch.events) {
    if (event.kind === "activation") {
      const location = locationFromLogData(event as unknown as Record<string, unknown>);
      if (location !== undefined) currentLiveLocation = location;
    }
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
  const statusChanged = batch.missing
    ? updateLiveStatus("waiting", `Waiting for ${fileName}`)
    : batch.invalidLines > 0
      ? updateLiveStatus("ready", `Reading ${fileName} with skipped lines`)
      : batch.events.length > 0
        ? updateLiveStatus("capturing", `Reading ${fileName}`)
        : updateLiveStatus(latestRecord() ? "ready" : "waiting", `Watching ${fileName}`);
  // A run of event batches restates the same "Reading …" line, so the status alone cannot be what
  // decides this: the numbers behind it moved even when the line did not.
  if (!statusChanged && (batch.events.length > 0 || batch.reset)) publishLiveProgress();
  // Events carried the meter forward; whether it still needs a beat of its own is decided here.
  scheduleLiveMeterTick();
}

/**
 * Redraws an open encounter while the log is quiet, and arms the next such pass.
 *
 * Once the encounter closes there is nothing left that changes without an event, so no timer is
 * scheduled and an idle window costs nothing.
 */
function tickLiveMeter(): void {
  liveMeterTimer = undefined;
  if (shuttingDown) return;
  const nowMs = relativeNowMs();
  if (nowMs !== undefined) liveMeter.advance(nowMs);
  lastLivePublishMs = Date.now();
  publish();
  scheduleLiveMeterTick();
}

/**
 * Publishes progress through the live log, at most once per tick interval.
 *
 * Batches arrive as fast as the logger flushes - roughly twenty a second during a fight - and each
 * publish sends the whole app state, snapshots included. The first event after a quiet stretch still
 * goes out at once; the rest are carried by the open encounter's own tick, so nothing is dropped.
 */
function publishLiveProgress(): void {
  const now = Date.now();
  if (now - lastLivePublishMs < LIVE_METER_TICK_MS) return;
  lastLivePublishMs = now;
  publish();
}

function scheduleLiveMeterTick(): void {
  if (liveMeterTimer !== undefined) clearTimeout(liveMeterTimer);
  liveMeterTimer = undefined;
  if (shuttingDown || liveMeter.getState(relativeNowMs()).current === undefined) return;
  liveMeterTimer = setTimeout(tickLiveMeter, LIVE_METER_TICK_MS);
  // A pending redraw is never a reason to keep the process alive.
  liveMeterTimer.unref?.();
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
    const sessions = await listLogSessions("combat", options.logDirectory, MAX_SCANNED_SESSIONS);
    const nextPaths = new Map<string, string>();
    const items: SessionPickerState["sessions"] = [];
    for (let offset = 0; offset < sessions.length && items.length < MAX_RECENT_SESSIONS; offset += 10) {
      const inspected = await Promise.all(sessions.slice(offset, offset + 10).map(async (session) => {
        try {
          const info = await stat(session.path);
          const cached = cache.get(session.path, info);
          const result = cached ?? {
            ...await inspectCombatReplaySummary(session.path),
            locations: await readCombatLocations(session.path),
          };
          if (!cached) cache.set(session.path, info, result);
          if (result.recordCount === 0) return undefined;
          nextPaths.set(session.id, session.path);
          return {
            id: session.id,
            createdAt: session.createdAt,
            summary: result.summary,
            locations: result.locations,
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

/**
 * Records the live status line, republishing only when it actually reads differently.
 *
 * Most passes through here restate what is already on screen — "Watching combat.jsonl" for as long
 * as nothing happens — and publishing sends the whole app state, snapshots included, over RPC.
 *
 * @returns whether the line changed, so a caller can tell its own publish apart from this one.
 */
function updateLiveStatus(nextStatus: DpsAppStatus, detail: string): boolean {
  if (status === nextStatus && statusDetail === detail) return false;
  status = nextStatus;
  statusDetail = detail;
  publish();
  return true;
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
  // Releases this consumer's hold on the shared log source, which disposes its watchers and fallback
  // timer once the last consumer lets go. It also unblocks the follow loop.
  liveLog.close();
  if (liveMeterTimer !== undefined) clearTimeout(liveMeterTimer);
  liveMeterTimer = undefined;
  try {
    await settingsPersistence.flush(settings);
  } finally {
    notifyClosed();
  }
}

/**
 * Reports the close exactly once.
 *
 * This cannot live only in the `close` event handler: every close in this app is programmatic (the
 * title bar is custom, so there is no native chrome to click), and teardown disposes that listener
 * before calling `window.close()`. The event would then arrive with nothing listening, leaving the
 * caller's slot pointing at a destroyed window — the next open would fail with "Window no longer
 * exists". Teardown always runs, so it is the reliable place to report from.
 */
function notifyClosed(): void {
  if (closedCallbackSent) return;
  closedCallbackSent = true;
  options.onClosed?.();
}
}
