import { localized, localizedCount } from "@svoverlay/i18n/messages";
import path from "node:path";

import { BrowserView, Utils } from "@svoverlay/desktop-runtime";
import type { BrowserWindow } from "@svoverlay/desktop-runtime";

import { inspectCombatReplaySummary } from "@kar-mi/spirit-vale-tools-combat";
import type { CharacterViewState } from "@kar-mi/spirit-vale-tools-character";
import { loadDpsAppSettings, saveDpsAppSettings } from "../settings.ts";
import type { CombatLogScreen, DpsAppRpc, DpsAppState } from "../app-types.ts";
import { SafeSaveQueue } from "@svoverlay/desktop-platform/safe-save";
import { createCombatAnalysisController } from "./combat-analysis-window.ts";
import { createManagedWindow } from "@svoverlay/desktop-platform/managed-window";
import { frameClamp, visibleScaledWindowFrame, type WindowPlacementStore } from "@svoverlay/desktop-platform/window-placement";
import { DPS_WINDOW_MINIMUM_HEIGHT, DPS_WINDOW_MINIMUM_WIDTH } from "../window-size.ts";
import { historyScanLimit, loadSessionSummaryJournal, normalizeHistorySessionLimit, type SessionDateRange, type SessionSummaryJournal } from "@svoverlay/desktop-platform/session-summary-journal";
import type { SessionPickerState, SessionZoneFilter } from "@svoverlay/desktop-platform/session-picker-types";
import { activeDeathLogSource } from "../combat-navigation.ts";
import type { CombatReadModelSource } from "../combat-history.ts";
import { readCombatLocations } from "../zone-log.ts";
import { matchesZoneKeys, spiritValeLocationKey, type SpiritValeLocation } from "@svoverlay/desktop-platform/location";
import { LiveCombatController } from "./live-combat-controller.ts";

const MINIMUM_WIDTH = DPS_WINDOW_MINIMUM_WIDTH;
const MINIMUM_HEIGHT = DPS_WINDOW_MINIMUM_HEIGHT;
export interface DpsWindowOptions {
  logDirectory: string;
  readModel?: CombatReadModelSource;
  getCharacterState: () => CharacterViewState;
  subscribeCharacter: (listener: (state: CharacterViewState) => void) => () => void;
  settingsPath?: string;
  getHistorySessionLimit?: () => number;
  placements?: WindowPlacementStore;
  onClosed?: () => void;
  onReset?: () => Promise<void>;
  onOpenSettings?: () => void;
  onOpenLiveDeathLog?: () => Promise<void> | void;
}

export async function createDpsWindow(options: DpsWindowOptions) {
const settings = await loadDpsAppSettings(options.settingsPath);
const initialCharacterState = options.getCharacterState();

let window: BrowserWindow;
let publishing = false;
let shuttingDown = false;
let closedCallbackSent = false;
let storageWarning: string | undefined;
let resetting = false;
let screen: CombatLogScreen = "live";
let pastDateRange: SessionDateRange = {};
let pastZones: string[] = [];
let pastZoneOptions: SpiritValeLocation[] = [];
let past: DpsAppState["past"] = { view: "selector", picker: pastPickerLoadingState() };
let pastPaths = new Map<string, string>();
let pastRefreshSequence = 0;
let pastSummaryJournalPromise: Promise<SessionSummaryJournal> | undefined;
const mainFrame = frameClamp(MINIMUM_WIDTH, MINIMUM_HEIGHT);

const settingsPersistence = new SafeSaveQueue<typeof settings>({
  label: "DPS settings",
  save: (value) => saveDpsAppSettings(value, options.settingsPath),
  onWarning: (warning) => { storageWarning = warning; publish(); },
});
const live = new LiveCombatController(options.logDirectory, initialCharacterState, publish);

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
      setPastDateRange: (dateRange) => {
        pastDateRange = normalizeDateRange(dateRange);
        if (screen === "past" && past.view === "selector") void refreshPastSessions();
        return appState();
      },
      setPastZones: ({ zones }) => {
        pastZones = normalizeZones(zones);
        if (screen === "past" && past.view === "selector") void refreshPastSessions();
        return appState();
      },
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
        const liveState = live.state();
        if (!liveState.logPath || !liveState.snapshots.snapshot) return;
        analysis.openLivePlayerDetails({
          actorId: request.actorId,
          fileName: path.basename(liveState.logPath),
          ...liveState.snapshots,
          statType: settings.statType,
        });
      },
      openActiveDeathLog: async () => {
        const source = activeDeathLogSource(screen, past.view, live.state().logPath !== undefined);
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
            live.reset();
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
        live.setPersonalActor(actorId ?? undefined);
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

const managed = createManagedWindow({
  title: "Spirit Vale DPS",
  url: "views://mainview/index.html",
  rpc,
  minimum: { width: MINIMUM_WIDTH, height: MINIMUM_HEIGHT },
  frame: visibleScaledWindowFrame(settings.frame, { width: MINIMUM_WIDTH, height: MINIMUM_HEIGHT }),
  onFrameChange: (logical) => { settings.frame = logical; scheduleSettingsSave(); },
  onClose: () => { void shutdown(); },
});
window = managed.window;

const unsubscribeCharacter = options.subscribeCharacter((state) => live.syncCharacter(state));
live.start();
return {
  show: () => window.show(),
  activate: () => window.activate(),
  close: async () => { await shutdown(); window.close(); },
};

function appState(): DpsAppState {
  const liveState = live.state();
  return {
    screen,
    tab: settings.tab,
    statType: settings.statType,
    status: liveState.status,
    statusDetail: liveState.statusDetail,
    ...(storageWarning ? { storageWarning: localized("storage.saveFailed") } : {}),
    personalName: liveState.personalName,
    ...(liveState.personalActorId === undefined ? {} : { personalActorId: liveState.personalActorId }),
    ...liveState.snapshots,
    resetting,
    ...(liveState.location === undefined ? {} : { location: liveState.location }),
    liveDeathLogAvailable: liveState.logPath !== undefined,
    past,
  };
}

function publish(): void {
  if (publishing || !window) return;
  publishing = true;
  try {
    const liveState = live.state();
    if (screen === "live" && liveState.logPath) {
      analysis.refreshLivePlayerDetails({
        fileName: path.basename(liveState.logPath),
        ...liveState.snapshots,
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

function pastSummaryJournal(): Promise<SessionSummaryJournal> {
  const journal = pastSummaryJournalPromise ?? loadSessionSummaryJournal(options.logDirectory);
  pastSummaryJournalPromise = journal;
  return journal;
}

async function refreshPastSessions(): Promise<void> {
  if (screen !== "past" || past.view !== "selector") return;
  const sequence = ++pastRefreshSequence;
  past = { view: "selector", picker: pastPickerLoadingState() };
  publish();
  try {
    const journal = await pastSummaryJournal();
    pastZoneOptions = journal.knownLocations("combat");
    const sessionLimit = normalizeHistorySessionLimit(options.getHistorySessionLimit?.());
    const sessions = await journal.list("combat", { limit: historyScanLimit(sessionLimit), dateRange: pastDateRange });
    const nextPaths = new Map<string, string>();
    const items: SessionPickerState["sessions"] = [];
    for (let offset = 0; offset < sessions.length && items.length < sessionLimit; offset += 10) {
      const batch = sessions.slice(offset, offset + 10);
      const publishProgress = batch.some((session) => session.cachedSummary === undefined);
      const inspected = await Promise.all(batch.map(async (session) => {
        try {
          const result = session.cachedSummary ?? await journal.ensure(session.id, "combat", {
            persist: !session.active,
            createdAt: session.createdAt,
            calculate: async () => ({
              ...await inspectCombatReplaySummary(session.path),
              locations: await readCombatLocations(session.path),
            }),
          });
          if (result.recordCount === 0 || !matchesZoneKeys(result.locations, pastZones)) return undefined;
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
          if (pastZones.length > 0) return undefined;
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
        if (item && items.length < sessionLimit) items.push(item);
      }
      if (sequence !== pastRefreshSequence || screen !== "past" || past.view !== "selector") return;
      if (!publishProgress) continue;
      pastPaths = nextPaths;
      past = {
        view: "selector",
        picker: {
          title: localized("sessions.title.pastCombatLogs"),
          status: "loading",
          statusDetail: localizedCount("sessions.scanning", items.length),
          sessions: items.slice(),
          canOpenLogFolder: true,
          dateRange: pastDateRange,
          zoneFilter: pastZoneFilter(),
        },
      };
      publish();
    }
    if (sequence !== pastRefreshSequence || screen !== "past" || past.view !== "selector") return;
    pastPaths = nextPaths;
    pastZoneOptions = journal.knownLocations("combat");
    past = {
      view: "selector",
      picker: {
        title: localized("sessions.title.pastCombatLogs"),
        status: "ready",
        statusDetail: items.length === 0
          ? localized(hasPastFilters() ? "sessions.noneFiltered" : "sessions.none")
          : localizedCount(hasPastFilters() ? "sessions.matching" : "sessions.recent", items.length),
        sessions: items,
        canOpenLogFolder: true,
        dateRange: pastDateRange,
        zoneFilter: pastZoneFilter(),
      },
    };
    publish();
  } catch {
    if (sequence !== pastRefreshSequence || screen !== "past" || past.view !== "selector") return;
    pastPaths.clear();
    past = {
      view: "selector",
      picker: {
        title: localized("sessions.title.pastCombatLogs"),
        status: "error",
        statusDetail: localized("sessions.scanFailed"),
        sessions: [],
        canOpenLogFolder: true,
        dateRange: pastDateRange,
        zoneFilter: pastZoneFilter(),
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
    title: localized("sessions.title.pastCombatLogs"),
    status: "loading",
    statusDetail: localized("sessions.scanningRecent"),
    sessions: [],
    canOpenLogFolder: true,
    dateRange: pastDateRange,
    zoneFilter: pastZoneFilter(),
  };
}

function pastZoneFilter(): SessionZoneFilter {
  return { selected: pastZones, available: pastZoneOptions };
}

function hasPastFilters(): boolean {
  return pastDateRange.fromMs !== undefined || pastDateRange.toMs !== undefined || pastZones.length > 0;
}

function normalizeDateRange(value: SessionDateRange): SessionDateRange {
  return {
    ...(typeof value.fromMs === "number" && Number.isFinite(value.fromMs) ? { fromMs: value.fromMs } : {}),
    ...(typeof value.toMs === "number" && Number.isFinite(value.toMs) ? { toMs: value.toMs } : {}),
  };
}

function normalizeZones(value: readonly string[]): string[] {
  const known = new Set(pastZoneOptions.map(spiritValeLocationKey));
  return [...new Set(value)].filter((zone) => known.has(zone));
}

function scheduleSettingsSave(): void {
  settingsPersistence.schedule(settings);
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  managed.lifecycle.dispose();
  analysis.close();
  unsubscribeCharacter();
  if (!window.isMaximized()) settings.frame = mainFrame.unscale(window.getFrame());
  live.close();
  notifyClosed();
  await settingsPersistence.flush(settings);
}

function notifyClosed(): void {
  if (closedCallbackSent) return;
  closedCallbackSent = true;
  options.onClosed?.();
}
}
