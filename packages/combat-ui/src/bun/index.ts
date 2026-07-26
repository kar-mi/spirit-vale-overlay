import path from "node:path";

import Electrobun, { BrowserView, BrowserWindow } from "electrobun/bun";
import { applyRoundedCorners } from "@spiritvale/ui-core/win32";

import {
  FishNetDpsMeter,
  DpsLogFollower,
  DpsSessionLogFollower,
  inspectCombatReplaySummary,
} from "@kar-mi/spirit-vale-tools-combat";
import { loadDpsAppSettings, saveDpsAppSettings } from "../settings.ts";
import type { DpsAppRpc, DpsAppState, DpsAppStatus } from "../app-types.ts";
import { SafeSaveQueue } from "@spiritvale/ui-core/safe-save";
import { createSessionPicker } from "@spiritvale/ui-core/session-picker";
import { Utils } from "electrobun/bun";
import { createCombatAnalysisWindow } from "./combat-analysis-window.ts";
import { registerUiScaleWindow, scaledSize, unscaledSize } from "@spiritvale/ui-core/ui-scale";
import { visibleScaledWindowFrame, type WindowPlacementStore } from "@spiritvale/ui-core/window-placement";
import { DPS_WINDOW_MINIMUM_HEIGHT, DPS_WINDOW_MINIMUM_WIDTH } from "../window-size.ts";

const MINIMUM_WIDTH = DPS_WINDOW_MINIMUM_WIDTH;
const MINIMUM_HEIGHT = DPS_WINDOW_MINIMUM_HEIGHT;
const LIVE_LOG_POLL_MS = 1_000;
export interface DpsWindowOptions {
  logDirectory: string;
  settingsPath?: string;
  placements?: WindowPlacementStore;
  onClosed?: () => void;
  onOpenOverlay?: () => Promise<void>;
  onReset?: () => Promise<void>;
}

export async function createDpsWindow(options: DpsWindowOptions) {
const liveLogOverride = process.env.SPIRIT_VALE_COMBAT_LOG;
const settings = await loadDpsAppSettings(options.settingsPath);

let window: BrowserWindow;
let status: DpsAppStatus = "waiting";
let statusDetail = liveLogOverride ? `Looking for ${path.basename(liveLogOverride)}…` : "Looking for a combat session…";
let liveMeter = new FishNetDpsMeter({ personalName: settings.personalName });
let manualPersonalActorId: number | undefined;
const liveLog = liveLogOverride ? new DpsLogFollower(liveLogOverride) : new DpsSessionLogFollower(options.logDirectory);
let liveLogPolling = false;
let publishing = false;
let shuttingDown = false;
let storageWarning: string | undefined;
let resetting = false;
let lastEventObservedAtMs: number | undefined;
let lastEventWallMs: number | undefined;

const settingsPersistence = new SafeSaveQueue<typeof settings>({
  label: "DPS settings",
  save: (value) => saveDpsAppSettings(value, options.settingsPath),
  onWarning: (warning) => { storageWarning = warning; publish(); },
});

const analysisWindow = createCombatAnalysisWindow({ placements: options.placements });

const replayPicker = createSessionPicker({
  logDirectory: options.logDirectory,
  stream: "combat",
  title: "Combat log analysis",
  summarize: inspectCombatReplaySummary,
  loadReplay: (selectedPath) => analysisWindow.open(selectedPath),
  placements: options.placements,
  placementKey: "combat-session-picker",
  openLogFolder: () => { void Utils.openPath(options.logDirectory); },
});

const rpc = BrowserView.defineRPC<DpsAppRpc>({
  maxRequestTime: 30_000,
  handlers: {
    requests: {
      getState: () => appState(),
      openReplayPicker: () => { replayPicker.open(); },
      openOverlay: async () => { await options.onOpenOverlay?.(); },
      resetSession: async () => {
        if (!resetting && options.onReset) {
          resetting = true;
          publish();
          try {
            await options.onReset();
            liveMeter = new FishNetDpsMeter({
              personalName: settings.personalName,
              ...(manualPersonalActorId === undefined ? {} : { personalActorId: manualPersonalActorId }),
            });
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
      setPersonalName: ({ name }) => {
        settings.personalName = name.trim();
        liveMeter.setPersonalName(settings.personalName);
        scheduleSettingsSave();
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
registerUiScaleWindow(window, { scaleInitialFrame: false });

Electrobun.events.on(`move-${window.id}`, (event: { data: typeof settings.frame }) => {
  if (window.isMaximized()) return;
  settings.frame = unscaleFrame(clampPhysicalFrame(event.data));
  scheduleSettingsSave();
});
Electrobun.events.on(`resize-${window.id}`, (event: { data: typeof settings.frame }) => {
  if (window.isMaximized()) return;
  const frame = clampPhysicalFrame(event.data);
  settings.frame = unscaleFrame(frame);
  if (event.data.width < scaledSize(MINIMUM_WIDTH) || event.data.height < scaledSize(MINIMUM_HEIGHT)) {
    window.setSize(frame.width, frame.height);
  }
  scheduleSettingsSave();
});
window.on("close", () => {
  void shutdown();
  options.onClosed?.();
});

const liveLogTimer = setInterval(() => void pollLiveLog(), LIVE_LOG_POLL_MS);
void pollLiveLog();
return {
  show: () => window.show(),
  activate: () => window.activate(),
  close: async () => { await shutdown(); window.close(); },
};

function appState(): DpsAppState {
  const snapshot = liveMeter.getLatestSnapshot(relativeNowMs());
  return {
    tab: settings.tab,
    status,
    statusDetail,
    ...(storageWarning ? { storageWarning } : {}),
    personalName: settings.personalName,
    ...(liveMeter.getPersonalActorId() === undefined ? {} : { personalActorId: liveMeter.getPersonalActorId() }),
    ...(snapshot ? { snapshot } : {}),
    resetting,
  };
}

function publish(): void {
  if (publishing || !window) return;
  publishing = true;
  try {
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
    if (batch.reset) {
      liveMeter = new FishNetDpsMeter({
        personalName: settings.personalName,
        ...(manualPersonalActorId === undefined ? {} : { personalActorId: manualPersonalActorId }),
      });
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
    else updateLiveStatus(liveMeter.getLatestSnapshot() ? "ready" : "waiting", `Watching ${fileName}`);
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
  replayPicker.close();
  analysisWindow.close();
  if (!window.isMaximized()) settings.frame = unscaleFrame(window.getFrame());
  clearInterval(liveLogTimer);
  await settingsPersistence.flush(settings);
}
}
