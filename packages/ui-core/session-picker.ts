import path from "node:path";

import Electrobun, { BrowserView, BrowserWindow, Utils } from "electrobun/bun";
import { listLogSessions } from "@kar-mi/spirit-vale-tools-logging";
import type { LogStream } from "@kar-mi/spirit-vale-tools-logging";
import { applyRoundedCorners } from "./win32.ts";
import { registerUiScaleWindow, scaledSize } from "./ui-scale.ts";
import type { WindowPlacementStore } from "./window-placement.ts";

import type { SessionPickerRpc, SessionPickerState } from "./session-picker-types.ts";
import type { WindowFrame } from "./window-chrome.ts";

const MAX_RECENT_SESSIONS = 100;

export interface SessionPickerOptions {
  logDirectory: string;
  stream: Extract<LogStream, "combat" | "rewards">;
  title: string;
  summarize: (path: string) => Promise<{ recordCount: number; summary: string }>;
  loadReplay: (path: string) => Promise<void>;
  placements?: WindowPlacementStore;
  placementKey?: string;
  defaultFrame?: WindowFrame;
  openLogFolder?: () => void;
}

export interface SessionPicker {
  open(): void;
  close(): void;
}

export function createSessionPicker(options: SessionPickerOptions): SessionPicker {
  let window: BrowserWindow | undefined;
  let state: SessionPickerState = loadingState(options.title);
  let paths = new Map<string, string>();
  let refreshSequence = 0;

  const rpc = BrowserView.defineRPC<SessionPickerRpc>({
    handlers: {
      requests: {
        getState: () => state,
        getWindowFrame: () => window?.getFrame()
          ?? pickerFrame()
          ?? options.defaultFrame
          ?? { x: 120, y: 120, width: 640, height: 560 },
        setWindowFrame: ({ x, y, width, height }) => { window?.setFrame(x, y, Math.max(480, width), Math.max(400, height)); },
      },
      messages: {
        refresh: () => { void refresh(); },
        openSession: ({ id }) => { void selectManaged(id); },
        openLogFolder: () => { options.openLogFolder?.(); },
        chooseFile: () => { void chooseFile(); },
        windowAction: ({ action }) => {
          if (action === "minimize") window?.minimize();
          else window?.close();
        },
      },
    },
  });

  return {
    open() {
      if (window) {
        window.show();
        window.activate();
      } else {
        const nextWindow = new BrowserWindow({
          title: options.title,
          url: "views://sessionpickerview/index.html",
          frame: pickerFrame() ?? options.defaultFrame ?? { x: 120, y: 120, width: 640, height: 560 },
          titleBarStyle: "hidden",
          transparent: false,
          rpc,
        });
        window = nextWindow;
        applyRoundedCorners(nextWindow.ptr);
        registerUiScaleWindow(nextWindow, { scaleInitialFrame: !options.placements });
        if (options.placementKey) options.placements?.track(options.placementKey, nextWindow);
        Electrobun.events.on(`resize-${nextWindow.id}`, (event: { data: { width: number; height: number } }) => {
          const width = Math.max(scaledSize(480), event.data.width);
          const height = Math.max(scaledSize(400), event.data.height);
          if (width !== event.data.width || height !== event.data.height) nextWindow.setSize(width, height);
        });
        nextWindow.on("close", () => {
          if (window === nextWindow) window = undefined;
          paths.clear();
        });
      }
      void refresh();
    },
    close() { window?.close(); },
  };

  function pickerFrame() {
    if (!options.placementKey) return undefined;
    return options.placements?.frame(
      options.placementKey,
      options.defaultFrame ?? { x: 120, y: 120, width: 640, height: 560 },
      { width: 480, height: 400 },
    );
  }

  async function refresh(): Promise<void> {
    const sequence = ++refreshSequence;
    state = loadingState(options.title);
    publish();
    try {
      const sessions = await listLogSessions(options.stream, options.logDirectory, Number.MAX_SAFE_INTEGER);
      const nextPaths = new Map<string, string>();
      const items: SessionPickerState["sessions"] = [];
      for (let offset = 0; offset < sessions.length && items.length < MAX_RECENT_SESSIONS; offset += 10) {
        const inspected = await Promise.all(sessions.slice(offset, offset + 10).map(async (session) => {
          try {
            const result = await options.summarize(session.path);
            if (result.recordCount === 0) return undefined;
            nextPaths.set(session.id, session.path);
            return { id: session.id, createdAt: session.createdAt, summary: result.summary, active: session.active, disabled: false };
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
      }
      if (sequence !== refreshSequence) return;
      paths = nextPaths;
      state = {
        title: options.title,
        status: "ready",
        statusDetail: items.length === 0 ? "No managed sessions found." : `${items.length} recent session${items.length === 1 ? "" : "s"}`,
        sessions: items,
        canOpenLogFolder: options.openLogFolder !== undefined,
      };
    } catch {
      if (sequence !== refreshSequence) return;
      paths.clear();
      state = { title: options.title, status: "error", statusDetail: "Recent sessions could not be scanned.", sessions: [], canOpenLogFolder: options.openLogFolder !== undefined };
    }
    publish();
  }

  async function selectManaged(id: string): Promise<void> {
    const selectedPath = paths.get(id);
    if (!selectedPath) return;
    await accept(selectedPath);
  }

  async function chooseFile(): Promise<void> {
    const [selectedPath] = await Utils.openFileDialog({
      startingFolder: Utils.paths.documents,
      allowedFileTypes: "jsonl,json",
      canChooseFiles: true,
      canChooseDirectory: false,
      allowsMultipleSelection: false,
    });
    if (!selectedPath) return;
    await accept(path.resolve(selectedPath));
  }

  async function accept(selectedPath: string): Promise<void> {
    try {
      await options.loadReplay(selectedPath);
      window?.close();
    } catch {
      // The parent owns replay error state. Keep the picker open for another choice.
    }
  }

  function publish(): void {
    try { rpc.send.stateChanged(state); } catch { /* The view may still be connecting. */ }
  }
}

function loadingState(title: string): SessionPickerState {
  return { title, status: "loading", statusDetail: "Scanning recent sessions…", sessions: [], canOpenLogFolder: false };
}
