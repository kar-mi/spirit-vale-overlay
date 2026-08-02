import path from "node:path";

import { BrowserView, BrowserWindow } from "electrobun/bun";
import { applyRoundedCorners, setWindowIcon } from "@spiritvale/ui-core/win32";
import { appIconPath } from "@spiritvale/ui-core/window-publish";
import { registerUiScaleWindow, scaledSize } from "@spiritvale/ui-core/ui-scale-window";
import type { WindowPlacementStore } from "@spiritvale/ui-core/window-placement";
import { DisposableStore, onWindowEvent, onceWindowEvent } from "@spiritvale/ui-core/window-lifecycle";

import type { CombatDeathLogRpc, CombatDeathLogState } from "../app-types.ts";
import { loadDeathLogReplay, selectionAfterDeathLogRefresh } from "../death-log.ts";
import type { DeathLogEntry } from "../death-log.ts";
import { toDeathLogEntries } from "../combat-history.ts";
import type { CombatReadModelSource } from "../combat-history.ts";
import { managedSessionId } from "@spiritvale/ui-core/managed-session";
import { CombatHistoryStore } from "@kar-mi/spirit-vale-tools-combat";

const FRAME = { x: 220, y: 180, width: 895, height: 789 };
/** Deaths held at once. The view lists them newest first and has no paging control. */
const MAX_DEATHS = 500;
const MINIMUM_WIDTH = 680;
const MINIMUM_HEIGHT = 500;

export interface DeathLogWindowOptions {
  logDirectory?: string;
  /** Managed session logs are read from here; anything else falls back to replaying the file. */
  readModel?: CombatReadModelSource;
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
    const loaded = await readDeaths(filePath);
    if (sequence !== loadSequence) return;
    const sameFile = loadedPath === filePath;
    const previousSelection = sameFile ? state?.selectedDeathId : undefined;
    const selectedDeathId = selectionAfterDeathLogRefresh(previousSelection, loaded.deaths);
    loadedPath = filePath;
    state = {
      fileName: path.basename(filePath),
      deaths: loaded.deaths,
      invalidLines: loaded.invalidLines,
      ...(selectedDeathId === undefined ? {} : { selectedDeathId }),
    };
    if (!opening || window) publish();
  }

  /**
   * Reads deaths from the index when the file is a managed session log, so a live refresh is a
   * bounded query rather than another full pass over a growing file. Anything else is replayed.
   */
  async function readDeaths(filePath: string): Promise<{ deaths: DeathLogEntry[]; invalidLines: number }> {
    const source = options.readModel;
    const sessionId = options.logDirectory === undefined
      ? undefined
      : managedSessionId(filePath, "combat", options.logDirectory);
    if (source && sessionId !== undefined) {
      // A live log keeps growing, so its trailing encounter must stay open for the next pass.
      const indexed = await source.indexSession(sessionId, "combat", { finalize: !live });
      const model = source.model();
      if (indexed && model) {
        const page = new CombatHistoryStore(model).getDeathLog({ sessionId, limit: MAX_DEATHS });
        return { deaths: toDeathLogEntries(page.items), invalidLines: 0 };
      }
    }
    const replay = await loadDeathLogReplay(filePath);
    return { deaths: [...replay.deaths], invalidLines: replay.invalidLines };
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
    const lifecycle = new DisposableStore();
    window = nextWindow;
    applyRoundedCorners(nextWindow.ptr);
    setWindowIcon(nextWindow.ptr, appIconPath);
    lifecycle.add(registerUiScaleWindow(nextWindow, { scaleInitialFrame: !options.placements }));
    const disposePlacement = options.placements?.track(placementKey, nextWindow);
    if (disposePlacement) lifecycle.add(disposePlacement);
    lifecycle.add(onWindowEvent(nextWindow, "resize", (event: { data: { width: number; height: number } }) => {
      const width = Math.max(scaledSize(MINIMUM_WIDTH), event.data.width);
      const height = Math.max(scaledSize(MINIMUM_HEIGHT), event.data.height);
      if (width !== event.data.width || height !== event.data.height) nextWindow.setSize(width, height);
    }));
    lifecycle.add(onceWindowEvent(nextWindow, "close", () => {
      lifecycle.dispose();
      if (window === nextWindow) {
        window = undefined;
        state = undefined;
        loadedPath = undefined;
        live = false;
      }
    }));
  }

  function publish(): void {
    if (!state) return;
    try { rpc.send.stateChanged(state); } catch { /* The view may still be connecting. */ }
  }
}
