import path from "node:path";

import Electrobun, { BrowserView, BrowserWindow } from "electrobun/bun";
import { applyRoundedCorners, setWindowIcon } from "@spiritvale/ui-core/win32";
import { appIconPath } from "@spiritvale/ui-core/window-publish";
import { registerUiScaleWindow, scaledSize } from "@spiritvale/ui-core/ui-scale";
import type { WindowPlacementStore } from "@spiritvale/ui-core/window-placement";

import type { CombatDeathLogRpc, CombatDeathLogState } from "../app-types.ts";
import { loadDeathLogReplay, selectionAfterDeathLogRefresh } from "../death-log.ts";

const FRAME = { x: 220, y: 180, width: 895, height: 789 };
const MINIMUM_WIDTH = 680;
const MINIMUM_HEIGHT = 500;

export interface DeathLogWindowOptions {
  placements?: WindowPlacementStore;
  placementKey?: string;
  defaultFrame?: { x: number; y: number; width: number; height: number };
  onOpenSettings?: () => void;
}

export interface DeathLogWindow {
  open(filePath: string, live?: boolean): Promise<void>;
  refresh(filePath: string): Promise<void>;
  close(): void;
  isOpen(): boolean;
}

/** Reusable death-log viewer. Live callers may refresh it as their active file grows. */
export function createDeathLogWindow(options: DeathLogWindowOptions = {}): DeathLogWindow {
  let window: BrowserWindow | undefined;
  let state: CombatDeathLogState | undefined;
  let loadedPath: string | undefined;
  let live = false;
  let loadSequence = 0;
  const placementKey = options.placementKey ?? "combat-death-log";
  const defaultFrame = options.defaultFrame ?? FRAME;

  const rpc = BrowserView.defineRPC<CombatDeathLogRpc>({
    handlers: {
      requests: {
        getState: () => {
          if (!state) throw new Error("No death log is loaded");
          return state;
        },
        selectDeath: ({ id }) => {
          if (state?.deaths.some((death) => death.id === id)) {
            state = { ...state, selectedDeathId: id };
            publish();
          }
          if (!state) throw new Error("No death log is loaded");
          return state;
        },
        openSettings: () => { options.onOpenSettings?.(); },
        windowAction: ({ action }) => {
          if (action === "minimize") window?.minimize();
          else window?.close();
        },
        getWindowFrame: () => window?.getFrame()
          ?? options.placements?.frame(placementKey, defaultFrame, { width: MINIMUM_WIDTH, height: MINIMUM_HEIGHT })
          ?? defaultFrame,
        setWindowFrame: (frame) => window?.setFrame(
          frame.x,
          frame.y,
          Math.max(scaledSize(MINIMUM_WIDTH), frame.width),
          Math.max(scaledSize(MINIMUM_HEIGHT), frame.height),
        ),
      },
      messages: {},
    },
  });

  return {
    async open(filePath, nextLive = false) {
      live = nextLive;
      await load(filePath, true);
      ensureWindow();
      window?.show();
      window?.activate();
    },
    async refresh(filePath) {
      if (!window || !live) return;
      await load(filePath, false);
    },
    close() { window?.close(); },
    isOpen: () => window !== undefined,
  };

  async function load(filePath: string, opening: boolean): Promise<void> {
    const sequence = ++loadSequence;
    const replay = await loadDeathLogReplay(filePath);
    if (sequence !== loadSequence) return;
    const sameFile = loadedPath === filePath;
    const previousSelection = sameFile ? state?.selectedDeathId : undefined;
    const selectedDeathId = selectionAfterDeathLogRefresh(previousSelection, replay.deaths);
    loadedPath = filePath;
    state = {
      fileName: path.basename(filePath),
      deaths: replay.deaths,
      invalidLines: replay.invalidLines,
      ...(selectedDeathId === undefined ? {} : { selectedDeathId }),
    };
    if (!opening || window) publish();
  }

  function ensureWindow(): void {
    if (window) return;
    const nextWindow = new BrowserWindow({
      title: "Combat Death Log",
      url: "views://deathlogview/index.html",
      frame: options.placements?.frame(placementKey, defaultFrame, { width: MINIMUM_WIDTH, height: MINIMUM_HEIGHT }) ?? defaultFrame,
      titleBarStyle: "hidden",
      transparent: false,
      rpc,
    });
    window = nextWindow;
    applyRoundedCorners(nextWindow.ptr);
    setWindowIcon(nextWindow.ptr, appIconPath);
    registerUiScaleWindow(nextWindow, { scaleInitialFrame: !options.placements });
    options.placements?.track(placementKey, nextWindow);
    Electrobun.events.on(`resize-${nextWindow.id}`, (event: { data: { width: number; height: number } }) => {
      const width = Math.max(scaledSize(MINIMUM_WIDTH), event.data.width);
      const height = Math.max(scaledSize(MINIMUM_HEIGHT), event.data.height);
      if (width !== event.data.width || height !== event.data.height) nextWindow.setSize(width, height);
    });
    nextWindow.on("close", () => {
      if (window === nextWindow) window = undefined;
    });
  }

  function publish(): void {
    if (!state) return;
    try { rpc.send.stateChanged(state); } catch { /* The view may still be connecting. */ }
  }
}
