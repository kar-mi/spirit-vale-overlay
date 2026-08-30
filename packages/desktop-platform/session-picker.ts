import path from "node:path";

import { BrowserView, BrowserWindow, Utils } from "@svoverlay/desktop-runtime";
import type { LogStream } from "@kar-mi/spirit-vale-tools-logging";
import { applyRoundedCorners, setWindowIcon } from "./win32.ts";
import { appIconPath } from "./window-publish.ts";
import { historyScanLimit, normalizeHistorySessionLimit } from "./history-limit.ts";
import { loadSessionSummaryJournal } from "./session-summary-journal.ts";
import type { SessionSummaryJournal } from "./session-summary-journal.ts";
import { registerUiScaleWindow, scaledSize } from "./ui-scale-window.ts";
import type { WindowPlacementStore } from "./window-placement.ts";

import type { SessionPickerRpc, SessionPickerState } from "./session-picker-types.ts";
import type { WindowFrame } from "@svoverlay/ui-kit/window-chrome";
import { DisposableStore, onWindowEvent, onceWindowEvent } from "./window-lifecycle.ts";

export interface SessionPickerOptions {
  logDirectory: string;
  stream: Extract<LogStream, "combat" | "rewards">;
  title: string;
  summarize: (path: string) => Promise<{ recordCount: number; summary: string }>;
  getSessionLimit?: () => number;
  loadReplay: (path: string) => Promise<void>;
  placements?: WindowPlacementStore;
  placementKey?: string;
  defaultFrame?: WindowFrame;
  openLogFolder?: () => void;
  onOpenSettings?: () => void;
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
  let journalPromise: Promise<SessionSummaryJournal> | undefined;

  function summaryJournal(): Promise<SessionSummaryJournal> {
    journalPromise ??= loadSessionSummaryJournal(options.logDirectory);
    return journalPromise;
  }

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
        openSettings: () => { options.onOpenSettings?.(); },
      },
    },
  });

  return {
    open() {
      if (window) {
        window.show();
        window.activate();
      } else {
        const lifecycle = new DisposableStore();
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
        setWindowIcon(nextWindow.ptr, appIconPath);
        lifecycle.add(registerUiScaleWindow(nextWindow, { scaleInitialFrame: !options.placements }));
        const disposePlacement = options.placementKey ? options.placements?.track(options.placementKey, nextWindow) : undefined;
        if (disposePlacement) lifecycle.add(disposePlacement);
        lifecycle.add(onWindowEvent(nextWindow, "resize", (event: { data: { width: number; height: number } }) => {
          const width = Math.max(scaledSize(480), event.data.width);
          const height = Math.max(scaledSize(400), event.data.height);
          if (width !== event.data.width || height !== event.data.height) nextWindow.setSize(width, height);
        }));
        lifecycle.add(onceWindowEvent(nextWindow, "close", () => {
          lifecycle.dispose();
          if (window === nextWindow) window = undefined;
          paths.clear();
          state = loadingState(options.title);
        }));
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
      const journal = await summaryJournal();
      const sessionLimit = normalizeHistorySessionLimit(options.getSessionLimit?.());
      const sessions = await journal.list(options.stream, { limit: historyScanLimit(sessionLimit) });
      const nextPaths = new Map<string, string>();
      const items: SessionPickerState["sessions"] = [];
      for (let offset = 0; offset < sessions.length && items.length < sessionLimit; offset += 10) {
        const batch = sessions.slice(offset, offset + 10);
        const publishProgress = batch.some((session) => session.cachedSummary === undefined);
        const inspected = await Promise.all(batch.map(async (session) => {
          try {
            const result = session.cachedSummary ?? await journal.ensure(session.id, options.stream, {
              persist: !session.active,
              createdAt: session.createdAt,
              calculate: () => options.summarize(session.path),
            });
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
          if (item && items.length < sessionLimit) items.push(item);
        }
        if (sequence !== refreshSequence) return;
        if (!publishProgress) continue;
        paths = nextPaths;
        state = {
          title: options.title,
          status: "loading",
          statusDetail: `Scanning… ${items.length} session${items.length === 1 ? "" : "s"} found so far`,
          sessions: items.slice(),
          canOpenLogFolder: options.openLogFolder !== undefined,
        };
        publish();
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
      allowedFileTypes: "jsonl",
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
