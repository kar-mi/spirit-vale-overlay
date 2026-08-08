import path from "node:path";

import { BrowserView, BrowserWindow } from "electrobun/bun";
import { mountRoundedWindow, publishSafely } from "@svoverlay/desktop-platform/window-publish";
import {
  inspectRewardsReplaySummary,
  LiveRewardService,
  LiveRewardSessionLogFollower,
  loadBundledMobRewardCatalog,
  loadRewardReplay,
  queryMobRewardCatalog,
  RewardHistoryStore,
} from "@kar-mi/spirit-vale-tools-rewards";
import type {
  RewardAggregateSnapshot,
  RewardLogStatus,
} from "@kar-mi/spirit-vale-tools-rewards";
import type { RateSnapshot } from "@kar-mi/spirit-vale-tools-metrics";
import type { ReadModel } from "@kar-mi/spirit-vale-tools-sqlite";
import type {
  RewardsAppMode,
  RewardsAppRpc,
  RewardsAppState,
  RewardsAppStatus,
  RewardsCatalogRpc,
  RewardsCatalogState,
} from "../app-types.ts";
import { loadRewardsSettings, saveRewardsSettings } from "../settings.ts";
import { xpToLevelUp } from "../xp-to-level.ts";
import { SafeSaveQueue } from "@svoverlay/desktop-platform/safe-save";
import { createSessionPicker } from "@svoverlay/desktop-platform/session-picker";
import { registerUiScaleWindow, scaledSize, unscaledSize } from "@svoverlay/desktop-platform/ui-scale-window";
import { visibleScaledWindowFrame, type WindowPlacementStore } from "@svoverlay/desktop-platform/window-placement";
import { DisposableStore, onWindowEvent, onceWindowEvent } from "@svoverlay/desktop-platform/window-lifecycle";
import { managedSessionId } from "@svoverlay/desktop-platform/managed-session";
import { chartBuckets, chartSample, CHART_POINTS, RECENT_KILL_LIMIT } from "../reward-chart.ts";
import { attributedKills, attributedMobSummaries } from "../reward-display.ts";

/** Backoff after a failed read. The follow loop is watcher-driven and has no interval otherwise. */
const READ_RETRY_MS = 1_000;
const catalog = loadBundledMobRewardCatalog();

/** The desktop process's shared SQLite read model, when it is available. */
export interface RewardsReadModelSource {
  model(): ReadModel | undefined;
  /**
   * Registers this window's interest so the service keeps the index warm, and returns a release
   * function to call when the window closes. Optional so test doubles need not implement it.
   */
  acquire?(): () => void;
  indexSession(
    sessionId: string,
    stream: "combat" | "rewards",
    options?: { finalize?: boolean },
  ): Promise<{ ok: boolean }>;
}

/** The Rewards window's XP Tracker tab reads from (and can reset) a tracker owned centrally, shared with the overlay, so both stay in sync. */
export interface XpTrackerSource {
  getSnapshot(): RateSnapshot;
  reset(): void;
  subscribe(listener: () => void): () => void;
}

export interface RewardsWindowOptions {
  logDirectory: string;
  /** Replays are read from here when present; without it they fall back to a full in-memory load. */
  readModel?: RewardsReadModelSource;
  xp: XpTrackerSource;
  getCharacterState(): { snapshot?: { level: number; experience: number } };
  subscribeCharacter(listener: () => void): () => void;
  settingsPath?: string;
  placements?: WindowPlacementStore;
  onClosed?: () => void;
  onReset?: () => Promise<void>;
  onOpenSettings?: () => void;
}

export async function createRewardsWindow(options: RewardsWindowOptions) {
const settings = await loadRewardsSettings(options.settingsPath);
const follower = new LiveRewardSessionLogFollower(options.logDirectory, {
  recentKillLimit: RECENT_KILL_LIMIT,
  chartPoints: CHART_POINTS,
});

let window: BrowserWindow;
let catalogWindow: BrowserWindow | undefined;
let mode: RewardsAppMode = "live";
let status: RewardsAppStatus = "waiting";
let statusDetail = "Waiting for rewards data from the central capture.";
let catalogQuery = "";
let liveSnapshot = emptyAggregate();
let replaySnapshot = emptyAggregate();
let replayFileName: string | undefined;
let replayWarnings = 0;
let shuttingDown = false;
let closedCallbackSent = false;
let storageWarning: string | undefined;
let resetting = false;
const lifecycle = new DisposableStore();
let catalogLifecycle: DisposableStore | undefined;

const settingsPersistence = new SafeSaveQueue<typeof settings>({
  label: "rewards settings",
  save: (value) => saveRewardsSettings(value, options.settingsPath),
  onWarning: (warning) => { storageWarning = warning; publish(); },
});

const replayPicker = createSessionPicker({
  logDirectory: options.logDirectory,
  stream: "rewards",
  title: "Rewards replays",
  summarize: inspectRewardsReplaySummary,
  loadReplay: loadReplayPath,
  placements: options.placements,
  placementKey: "rewards-session-picker",
  defaultFrame: { x: 120, y: 120, width: 757, height: 612 },
  onOpenSettings: options.onOpenSettings,
});

const rpc = BrowserView.defineRPC<RewardsAppRpc>({
  maxRequestTime: 30_000,
  handlers: {
    requests: {
      getState: () => appState(),
      setMode: ({ mode: nextMode }) => { mode = nextMode; publish(); return appState(); },
      setView: ({ view }) => { settings.view = view; scheduleSave(); publish(); return appState(); },
      openCatalog: () => { openCatalog(); },
      openSettings: () => { options.onOpenSettings?.(); },
      openReplayPicker: () => { replayPicker.open(); },
      resetSession: async () => {
        if (!resetting && mode === "live" && options.onReset) {
          resetting = true;
          publish();
          try {
            await options.onReset();
            liveSnapshot = emptyAggregate();
          } catch {
            // Keep the existing snapshot unchanged when rotation fails.
          } finally {
            resetting = false;
          }
        }
        publish();
        return appState();
      },
      resetXpTracker: () => {
        options.xp.reset();
        return appState();
      },
      setPinned: ({ pinned }) => {
        settings.pinned = pinned;
        window.setAlwaysOnTop(pinned);
        catalogWindow?.setAlwaysOnTop(pinned);
        scheduleSave();
        publish();
        return appState();
      },
      windowAction: async ({ action }) => {
        if (action === "minimize") window.minimize();
        else {
          await shutdown();
          window.close();
        }
      },
      getWindowFrame: () => window.getFrame(),
      setWindowFrame: ({ x, y, width, height }) => { window.setFrame(x, y, width, height); },
      toggleMaximize: () => {
        if (window.isMaximized()) window.unmaximize();
        else window.maximize();
        return { maximized: window.isMaximized() };
      },
    },
    messages: {},
  },
});

const catalogRpc = BrowserView.defineRPC<RewardsCatalogRpc>({
  handlers: {
    requests: {
      getState: () => catalogState(),
      openSettings: () => { options.onOpenSettings?.(); },
      setQuery: ({ query }) => {
        catalogQuery = query.trim().slice(0, 200);
        publishCatalog();
        return catalogState();
      },
      windowAction: ({ action }) => {
        if (action === "minimize") catalogWindow?.minimize();
        else if (catalogWindow) {
          if (!catalogWindow.isMaximized()) {
            settings.catalogFrame = unscaleCatalogFrame(clampPhysicalCatalogFrame(catalogWindow.getFrame()));
          }
          scheduleSave();
          catalogWindow.close();
        }
      },
      getWindowFrame: () => catalogWindow?.getFrame() ?? settings.catalogFrame,
      setWindowFrame: ({ x, y, width, height }) => { catalogWindow?.setFrame(x, y, width, height); },
      toggleMaximize: () => {
        if (!catalogWindow) return { maximized: false };
        if (catalogWindow.isMaximized()) catalogWindow.unmaximize();
        else catalogWindow.maximize();
        return { maximized: catalogWindow.isMaximized() };
      },
    },
    messages: {},
  },
});

window = new BrowserWindow({
  title: "Spirit Vale Mob Rewards",
  url: "views://rewardsview/index.html",
  frame: visibleScaledWindowFrame(settings.frame, { width: 620, height: 520 }),
  titleBarStyle: "hidden",
  transparent: false,
  rpc,
});
window.setAlwaysOnTop(settings.pinned);
mountRoundedWindow(window);
lifecycle.add(registerUiScaleWindow(window, { scaleInitialFrame: false }));

lifecycle.add(onWindowEvent(window, "move", (event: { data: typeof settings.frame }) => {
  if (window.isMaximized()) return;
  settings.frame = unscaleFrame(clampPhysicalFrame(event.data));
  scheduleSave();
}));
lifecycle.add(onWindowEvent(window, "resize", (event: { data: typeof settings.frame }) => {
  if (window.isMaximized()) return;
  const frame = clampPhysicalFrame(event.data);
  settings.frame = unscaleFrame(frame);
  if (frame.width !== event.data.width || frame.height !== event.data.height) window.setSize(frame.width, frame.height);
  scheduleSave();
}));
lifecycle.add(onceWindowEvent(window, "close", () => { void shutdown(); }));

void followRewards();
const unsubscribeXp = options.xp.subscribe(() => publish());
const unsubscribeCharacter = options.subscribeCharacter(() => publish());
return {
  show: () => window.show(),
  activate: () => window.activate(),
  close: async () => { await shutdown(); window.close(); },
};

function appState(): RewardsAppState {
  const snapshot = mode === "live" ? liveSnapshot : replaySnapshot;
  const character = options.getCharacterState().snapshot;
  const remainingExperience = character
    ? xpToLevelUp(character.level, character.experience, catalog.experienceRequirements)
    : undefined;
  return {
    mode,
    view: settings.view,
    status: mode === "replay" ? (replayFileName ? "ready" : "stopped") : status,
    statusDetail: mode === "replay" ? (replayFileName ? `Replay: ${replayFileName}` : "Choose a rewards log") : statusDetail,
    ...(storageWarning ? { storageWarning } : {}),
    pinned: settings.pinned,
    resetting,
    ...(replayFileName ? { replayFileName } : {}),
    replayWarnings,
    // Already bounded to RECENT_KILL_LIMIT by the aggregator, newest first.
    kills: attributedKills(snapshot.recentKills).map((kill) => ({
      id: kill.id,
      ...(kill.recordedAt === undefined ? {} : { timestamp: kill.recordedAt }),
      mobId: kill.mob.mobId,
      displayName: kill.mob.displayName,
      level: kill.mob.level,
      experience: kill.experience,
      jobExperience: kill.jobExperience,
      coins: kill.coins.toString(),
      drops: kill.drops.map((drop) => ({ ...drop, itemName: itemName(drop.itemId) })),
    })),
    graphSamples: snapshot.chart.map(chartSample),
    summaries: attributedMobSummaries(snapshot.mobs).map((mob) => ({
      ...mob,
      coins: mob.coins.toString(),
      drops: mob.drops.map((drop) => ({ ...drop, itemName: itemName(drop.itemId) })),
    })),
    totalExperience: snapshot.totalExperience,
    ...(remainingExperience === undefined ? {} : { xpToLevelUp: remainingExperience }),
    totalJobExperience: snapshot.totalJobExperience,
    totalCoins: snapshot.totalCoins.toString(),
    unmatched: snapshot.unmatched,
    unmatchedDrops: snapshot.unmatchedDrops.map((drop) => ({ ...drop, itemName: itemName(drop.itemId) })),
    unidentified: snapshot.unmatchedByReason.unidentified,
    xp: options.xp.getSnapshot(),
  };
}

function catalogState(): RewardsCatalogState {
  const mobs = queryMobRewardCatalog(catalog, { text: catalogQuery });
  return {
    query: catalogQuery,
    catalogCount: catalog.mobs.length,
    catalog: mobs.map((mob) => ({ ...mob, drops: mob.drops.map((drop) => ({ ...drop })) })),
  };
}

function openCatalog(): void {
  if (catalogWindow) {
    catalogWindow.show();
    catalogWindow.activate();
    return;
  }

  const nextWindow = new BrowserWindow({
    title: "Spirit Vale Mob Catalog",
    url: "views://rewardscatalogview/index.html",
    frame: visibleScaledWindowFrame(settings.catalogFrame, { width: 520, height: 420 }),
    titleBarStyle: "hidden",
    transparent: false,
    rpc: catalogRpc,
  });
  const nextLifecycle = new DisposableStore();
  catalogWindow = nextWindow;
  catalogLifecycle = nextLifecycle;
  nextWindow.setAlwaysOnTop(settings.pinned);
  mountRoundedWindow(nextWindow);
  nextLifecycle.add(registerUiScaleWindow(nextWindow, { scaleInitialFrame: false }));

  nextLifecycle.add(onWindowEvent(nextWindow, "move", (event: { data: typeof settings.catalogFrame }) => {
    if (nextWindow.isMaximized()) return;
    settings.catalogFrame = unscaleCatalogFrame(clampPhysicalCatalogFrame(event.data));
    scheduleSave();
  }));
  nextLifecycle.add(onWindowEvent(nextWindow, "resize", (event: { data: typeof settings.catalogFrame }) => {
    if (nextWindow.isMaximized()) return;
    const frame = clampPhysicalCatalogFrame(event.data);
    settings.catalogFrame = unscaleCatalogFrame(frame);
    if (frame.width !== event.data.width || frame.height !== event.data.height) nextWindow.setSize(frame.width, frame.height);
    scheduleSave();
  }));
  nextLifecycle.add(onceWindowEvent(nextWindow, "close", () => {
    nextLifecycle.dispose();
    catalogWindow = undefined;
    catalogLifecycle = undefined;
    scheduleSave();
  }));
}

/**
 * Follows the rewards log for as long as the window is open.
 *
 * The follower wakes on a filesystem event rather than on a timer, so an idle rewards window costs
 * nothing. `close()` settles a parked `next()`, which is what unwinds this on teardown.
 */
async function followRewards(): Promise<void> {
  while (!shuttingDown) {
    try {
      const batch = await follower.next();
      if (shuttingDown) return;
      if (batch.changed || batch.reset || batch.status !== status) {
        liveSnapshot = batch.snapshot;
        status = batch.status;
        statusDetail = detail(batch.status, batch.invalidLines, batch.snapshot.unmatchedByReason.unidentified);
        if (mode === "live") publish();
      }
    } catch {
      status = "error";
      statusDetail = "The current rewards log could not be read.";
      publish();
      // Back off rather than spinning: whatever failed will not be fixed by retrying at once.
      await new Promise((resolve) => setTimeout(resolve, READ_RETRY_MS));
    }
  }
}

async function loadReplayPath(selectedPath: string): Promise<void> {
  try {
    replaySnapshot = await indexedReplay(selectedPath) ?? await fullReplay(selectedPath);
    replayFileName = path.basename(selectedPath);
    mode = "replay";
  } catch {
    replaySnapshot = emptyAggregate();
    replayWarnings = 0;
    replayFileName = undefined;
    publish();
    throw new Error("rewards replay could not be loaded");
  }
  publish();
}

/**
 * Reads a replay out of the shared read model, which indexes the log in one streaming pass and
 * returns only the bounded summary. Resolves to undefined when there is no read model, or when the
 * chosen file is not a managed session log (a file picked from anywhere on disk has no session id),
 * leaving the caller to fall back to the full in-memory load.
 */
async function indexedReplay(selectedPath: string): Promise<RewardAggregateSnapshot | undefined> {
  const source = options.readModel;
  if (!source) return undefined;
  const sessionId = managedSessionId(selectedPath, "rewards", options.logDirectory);
  if (!sessionId) return undefined;
  if (!(await source.indexSession(sessionId, "rewards")).ok) return undefined;
  const model = source.model();
  if (!model) return undefined;
  const summary = new RewardHistoryStore(model).getSummary(sessionId, {
    recentKillLimit: RECENT_KILL_LIMIT,
    chartPoints: CHART_POINTS,
  });
  replayWarnings = 0;
  return summary;
}

/**
 * Fallback for a log the read model cannot index: load the whole session, then keep only the
 * bounded projection of it the UI actually renders. Totals, per-mob summaries and unmatched counts
 * come straight from the full snapshot, so nothing is lost by bounding the kills and the chart.
 */
async function fullReplay(selectedPath: string): Promise<RewardAggregateSnapshot> {
  const replay = await loadRewardReplay(selectedPath);
  replayWarnings = replay.invalidLines;
  const snapshot = replay.snapshot;
  return {
    revision: 0,
    killCount: snapshot.kills.length,
    recentKills: attributedKills(snapshot.kills).slice(0, RECENT_KILL_LIMIT),
    mobs: snapshot.mobs,
    chart: chartBuckets(snapshot.kills),
    totalExperience: snapshot.totalExperience,
    totalJobExperience: snapshot.totalJobExperience,
    totalCoins: snapshot.totalCoins,
    unmatched: snapshot.unmatched,
    unmatchedDrops: snapshot.unmatchedDrops,
    unmatchedByReason: snapshot.unmatchedByReason,
  };
}

function emptyAggregate(): RewardAggregateSnapshot {
  return new LiveRewardService({ recentKillLimit: RECENT_KILL_LIMIT, chartPoints: CHART_POINTS }).snapshot();
}

function itemName(itemId: string): string {
  for (const mob of catalog.mobs) {
    const drop = mob.drops.find((candidate) => candidate.itemId === itemId);
    if (drop) return drop.itemName;
  }
  return itemId.replace(/^currency:/, "Currency ");
}

function detail(next: RewardLogStatus, invalidLines: number, unidentified: number): string {
  const skipped = invalidLines > 0 ? ` · ${invalidLines} malformed records skipped` : "";
  const warmup = unidentified > 0 ? ` · ${unidentified} rewards missed mob identity from before capture` : "";
  switch (next) {
    case "waiting": return "Waiting for rewards data from the central capture.";
    case "watching": return `Rewards session found; waiting for a confirmed kill.${warmup}${skipped}`;
    case "ready": return `Tracking confirmed mob rewards.${warmup}${skipped}`;
    case "stopped": return `Rewards session stopped; showing its final state.${warmup}${skipped}`;
    case "error": return "The rewards session reported an error.";
  }
}

function publish(): void {
  publishSafely(() => rpc.send.stateChanged(appState()));
}

function publishCatalog(): void {
  publishSafely(() => catalogRpc.send.stateChanged(catalogState()));
}

function clampFrame(frame: typeof settings.frame): typeof settings.frame {
  return { x: frame.x, y: frame.y, width: Math.max(620, frame.width), height: Math.max(520, frame.height) };
}

function clampCatalogFrame(frame: typeof settings.catalogFrame): typeof settings.catalogFrame {
  return { x: frame.x, y: frame.y, width: Math.max(520, frame.width), height: Math.max(420, frame.height) };
}

function unscaleFrame(frame: typeof settings.frame): typeof settings.frame {
  return clampFrame({ x: frame.x, y: frame.y, width: unscaledSize(frame.width), height: unscaledSize(frame.height) });
}

function clampPhysicalFrame(frame: typeof settings.frame): typeof settings.frame {
  return { x: frame.x, y: frame.y, width: Math.max(scaledSize(620), frame.width), height: Math.max(scaledSize(520), frame.height) };
}

function unscaleCatalogFrame(frame: typeof settings.catalogFrame): typeof settings.catalogFrame {
  return clampCatalogFrame({ x: frame.x, y: frame.y, width: unscaledSize(frame.width), height: unscaledSize(frame.height) });
}

function clampPhysicalCatalogFrame(frame: typeof settings.catalogFrame): typeof settings.catalogFrame {
  return { x: frame.x, y: frame.y, width: Math.max(scaledSize(520), frame.width), height: Math.max(scaledSize(420), frame.height) };
}

function scheduleSave(): void {
  if (shuttingDown) return;
  settingsPersistence.schedule(settings);
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  lifecycle.dispose();
  catalogLifecycle?.dispose();
  catalogLifecycle = undefined;
  replayPicker.close();
  // Releases this consumer's hold on the shared log source, which disposes its watchers and fallback
  // timer once the last consumer lets go. It also unblocks the follow loop.
  follower.close();
  unsubscribeXp();
  unsubscribeCharacter();
  catalogWindow?.close();
  catalogWindow = undefined;
  liveSnapshot = emptyAggregate();
  replaySnapshot = emptyAggregate();
  if (!window.isMaximized()) settings.frame = unscaleFrame(window.getFrame());
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
