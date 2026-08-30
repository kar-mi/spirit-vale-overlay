import path from "node:path";

import { BrowserView, BrowserWindow } from "@svoverlay/desktop-runtime";
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
  RateTotals,
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
import { registerLocaleWindow } from "@svoverlay/desktop-platform/locale-window";
import { localized, localizedCount, type LocalizedText } from "@svoverlay/i18n/messages";
import { visibleScaledWindowFrame, type WindowPlacementStore } from "@svoverlay/desktop-platform/window-placement";
import { DisposableStore, onWindowEvent, onceWindowEvent } from "@svoverlay/desktop-platform/window-lifecycle";
import { managedSessionId } from "@svoverlay/desktop-platform/managed-session";
import { chartBuckets, chartSample, CHART_POINTS, RECENT_KILL_LIMIT } from "../reward-chart.ts";
import { attributedKills, attributedMobSummaries } from "../reward-display.ts";

const READ_RETRY_MS = 1_000;
const catalog = loadBundledMobRewardCatalog();

export interface RewardsReadModelSource {
  model(): ReadModel | undefined;
  acquire?(): () => void;
  indexSession(
    sessionId: string,
    stream: "combat" | "rewards",
    options?: { finalize?: boolean },
  ): Promise<{ ok: boolean }>;
}

export interface XpTrackerSource {
  getSnapshot(): RateSnapshot;
  reset(): void;
  getCoinsSnapshot(): RateTotals;
  resetCoins(): void;
  subscribe(listener: () => void): () => void;
}

export interface RewardsWindowOptions {
  logDirectory: string;
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
let statusDetail: LocalizedText = localized("rewards.status.waiting");
let statusDetailExtras: LocalizedText[] = [];
let catalogQuery = "";
let liveSnapshot = emptyAggregate();
let replaySnapshot = emptyAggregate();
let replayFileName: string | undefined;
let replayWarnings = 0;
let shuttingDown = false;
let closedCallbackSent = false;
let storageWarning: LocalizedText | undefined;
let resetting = false;
const lifecycle = new DisposableStore();
let catalogLifecycle: DisposableStore | undefined;

const settingsPersistence = new SafeSaveQueue<typeof settings>({
  label: "rewards settings",
  save: (value) => saveRewardsSettings(value, options.settingsPath),
  onWarning: (warning) => { storageWarning = warning ? localized("storage.saveFailed") : undefined; publish(); },
});

const replayPicker = createSessionPicker({
  logDirectory: options.logDirectory,
  stream: "rewards",
  titleKey: "sessions.title.rewardsReplays",
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
      resetGoldTracker: () => {
        options.xp.resetCoins();
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
lifecycle.add(registerLocaleWindow(window));

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
    statusDetail: mode === "replay"
      ? (replayFileName ? localized("rewards.status.replay", { file: replayFileName }) : localized("rewards.status.chooseLog"))
      : statusDetail,
    ...(mode === "replay" || statusDetailExtras.length === 0 ? {} : { statusDetailExtras }),
    ...(storageWarning ? { storageWarning } : {}),
    pinned: settings.pinned,
    resetting,
    ...(replayFileName ? { replayFileName } : {}),
    replayWarnings,
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
    gold: options.xp.getCoinsSnapshot(),
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
  nextLifecycle.add(registerLocaleWindow(nextWindow));

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

async function followRewards(): Promise<void> {
  while (!shuttingDown) {
    try {
      const batch = await follower.next();
      if (shuttingDown) return;
      if (batch.changed || batch.reset || batch.status !== status) {
        liveSnapshot = batch.snapshot;
        status = batch.status;
        statusDetail = detail(batch.status);
        statusDetailExtras = detailExtras(batch.status, batch.invalidLines, batch.snapshot.unmatchedByReason.unidentified);
        if (mode === "live") publish();
      }
    } catch {
      status = "error";
      statusDetail = localized("rewards.status.logUnreadable");
      statusDetailExtras = [];
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

function detail(next: RewardLogStatus): LocalizedText {
  switch (next) {
    case "waiting": return localized("rewards.status.waiting");
    case "watching": return localized("rewards.status.watching");
    case "ready": return localized("rewards.status.ready");
    case "stopped": return localized("rewards.status.stopped");
    case "error": return localized("rewards.status.error");
  }
}

/** Only the three mid-session states carry counts; waiting and error stand alone. */
function detailExtras(next: RewardLogStatus, invalidLines: number, unidentified: number): LocalizedText[] {
  if (next !== "watching" && next !== "ready" && next !== "stopped") return [];
  const extras: LocalizedText[] = [];
  if (unidentified > 0) extras.push(localizedCount("rewards.status.warmup", unidentified));
  if (invalidLines > 0) extras.push(localizedCount("rewards.status.malformed", invalidLines));
  return extras;
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

function notifyClosed(): void {
  if (closedCallbackSent) return;
  closedCallbackSent = true;
  options.onClosed?.();
}
}
