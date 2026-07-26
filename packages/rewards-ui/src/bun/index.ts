import path from "node:path";

import Electrobun, { BrowserView, BrowserWindow } from "electrobun/bun";
import { mountRoundedWindow, publishSafely } from "@spiritvale/ui-core/window-publish";
import {
  emptySnapshot,
  inspectRewardsReplaySummary,
  loadBundledMobRewardCatalog,
  loadRewardReplay,
  queryMobRewardCatalog,
  RewardSessionLogFollower,
} from "@kar-mi/spirit-vale-tools-rewards";
import type { RewardLogStatus } from "@kar-mi/spirit-vale-tools-rewards";
import type {
  RewardsAppMode,
  RewardsAppRpc,
  RewardsAppState,
  RewardsAppStatus,
  RewardsCatalogRpc,
  RewardsCatalogState,
} from "../app-types.ts";
import { loadRewardsSettings, saveRewardsSettings } from "../settings.ts";
import { SafeSaveQueue } from "@spiritvale/ui-core/safe-save";
import { createSessionPicker } from "@spiritvale/ui-core/session-picker";
import { registerUiScaleWindow, scaledSize, unscaledSize } from "@spiritvale/ui-core/ui-scale";
import { visibleScaledWindowFrame, type WindowPlacementStore } from "@spiritvale/ui-core/window-placement";

const POLL_MS = 1_000;
const catalog = loadBundledMobRewardCatalog();

export interface RewardsWindowOptions {
  logDirectory: string;
  settingsPath?: string;
  placements?: WindowPlacementStore;
  onClosed?: () => void;
  onReset?: () => Promise<void>;
}

export async function createRewardsWindow(options: RewardsWindowOptions) {
const settings = await loadRewardsSettings(options.settingsPath);
const follower = new RewardSessionLogFollower(options.logDirectory);

let window: BrowserWindow;
let catalogWindow: BrowserWindow | undefined;
let mode: RewardsAppMode = "live";
let status: RewardsAppStatus = "waiting";
let statusDetail = "Waiting for rewards data from the central capture.";
let catalogQuery = "";
let liveSnapshot = emptySnapshot();
let replaySnapshot = emptySnapshot();
let replayFileName: string | undefined;
let replayWarnings = 0;
let polling = false;
let shuttingDown = false;
let storageWarning: string | undefined;
let resetting = false;

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
  defaultFrame: { x: 120, y: 120, width: 736, height: 612 },
});

const rpc = BrowserView.defineRPC<RewardsAppRpc>({
  maxRequestTime: 30_000,
  handlers: {
    requests: {
      getState: () => appState(),
      setMode: ({ mode: nextMode }) => { mode = nextMode; publish(); return appState(); },
      setView: ({ view }) => { settings.view = view; scheduleSave(); publish(); return appState(); },
      openCatalog: () => { openCatalog(); },
      openReplayPicker: () => { replayPicker.open(); },
      resetSession: async () => {
        if (!resetting && mode === "live" && options.onReset) {
          resetting = true;
          publish();
          try {
            await options.onReset();
            liveSnapshot = emptySnapshot();
          } catch {
            // Keep the existing snapshot unchanged when rotation fails.
          } finally {
            resetting = false;
          }
        }
        publish();
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
registerUiScaleWindow(window, { scaleInitialFrame: false });

Electrobun.events.on(`move-${window.id}`, (event: { data: typeof settings.frame }) => {
  if (window.isMaximized()) return;
  settings.frame = unscaleFrame(clampPhysicalFrame(event.data));
  scheduleSave();
});
Electrobun.events.on(`resize-${window.id}`, (event: { data: typeof settings.frame }) => {
  if (window.isMaximized()) return;
  const frame = clampPhysicalFrame(event.data);
  settings.frame = unscaleFrame(frame);
  if (frame.width !== event.data.width || frame.height !== event.data.height) window.setSize(frame.width, frame.height);
  scheduleSave();
});
window.on("close", () => {
  void shutdown();
  options.onClosed?.();
});

const timer = setInterval(() => void poll(), POLL_MS);
void poll();
return {
  show: () => window.show(),
  activate: () => window.activate(),
  close: async () => { await shutdown(); window.close(); },
};

function appState(): RewardsAppState {
  const snapshot = mode === "live" ? liveSnapshot : replaySnapshot;
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
    kills: snapshot.kills.slice(0, 100).map((kill) => ({
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
    graphSamples: snapshot.kills.flatMap((kill) => kill.recordedAt === undefined ? [] : [{
      recordedAt: kill.recordedAt,
      experience: kill.experience,
      jobExperience: kill.jobExperience,
      coins: kill.coins.toString(),
    }]),
    summaries: snapshot.mobs.map((mob) => ({
      ...mob,
      coins: mob.coins.toString(),
      drops: mob.drops.map((drop) => ({ ...drop, itemName: itemName(drop.itemId) })),
    })),
    totalExperience: snapshot.totalExperience,
    totalJobExperience: snapshot.totalJobExperience,
    totalCoins: snapshot.totalCoins.toString(),
    unmatched: snapshot.unmatched,
    unmatchedDrops: snapshot.unmatchedDrops.map((drop) => ({ ...drop, itemName: itemName(drop.itemId) })),
    unidentified: snapshot.unmatchedByReason.unidentified,
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
  catalogWindow = nextWindow;
  nextWindow.setAlwaysOnTop(settings.pinned);
  mountRoundedWindow(nextWindow);
  registerUiScaleWindow(nextWindow, { scaleInitialFrame: false });

  Electrobun.events.on(`move-${nextWindow.id}`, (event: { data: typeof settings.catalogFrame }) => {
    if (nextWindow.isMaximized()) return;
    settings.catalogFrame = unscaleCatalogFrame(clampPhysicalCatalogFrame(event.data));
    scheduleSave();
  });
  Electrobun.events.on(`resize-${nextWindow.id}`, (event: { data: typeof settings.catalogFrame }) => {
    if (nextWindow.isMaximized()) return;
    const frame = clampPhysicalCatalogFrame(event.data);
    settings.catalogFrame = unscaleCatalogFrame(frame);
    if (frame.width !== event.data.width || frame.height !== event.data.height) nextWindow.setSize(frame.width, frame.height);
    scheduleSave();
  });
  nextWindow.on("close", () => {
    catalogWindow = undefined;
    scheduleSave();
  });
}

async function poll(): Promise<void> {
  if (polling || shuttingDown) return;
  polling = true;
  try {
    const batch = await follower.poll();
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
  } finally { polling = false; }
}

async function loadReplayPath(selectedPath: string): Promise<void> {
  try {
    const replay = await loadRewardReplay(selectedPath);
    replaySnapshot = replay.snapshot;
    replayWarnings = replay.invalidLines;
    replayFileName = path.basename(selectedPath);
    mode = "replay";
  } catch {
    replaySnapshot = emptySnapshot();
    replayWarnings = 0;
    replayFileName = undefined;
    publish();
    throw new Error("rewards replay could not be loaded");
  }
  publish();
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
  replayPicker.close();
  clearInterval(timer);
  catalogWindow?.close();
  if (!window.isMaximized()) settings.frame = unscaleFrame(window.getFrame());
  await settingsPersistence.flush(settings);
}
}
