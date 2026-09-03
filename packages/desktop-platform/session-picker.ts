import { countedMessage, message, translate } from "@svoverlay/i18n/backend";
import type { MessageKey } from "@svoverlay/i18n/messages";
import path from "node:path";

import { BrowserView, Utils } from "@svoverlay/desktop-runtime";
import type { BrowserWindow } from "@svoverlay/desktop-runtime";
import type { LogStream } from "@kar-mi/spirit-vale-tools-logging";
import { historyScanLimit, loadSessionSummaryJournal, normalizeHistorySessionLimit } from "./session-summary-journal.ts";
import type { SessionSummaryJournal } from "./session-summary-journal.ts";
import type { WindowPlacementStore } from "./window-placement.ts";
import { createManagedWindow } from "./managed-window.ts";

import type { SessionPickerRpc, SessionPickerState } from "./session-picker-types.ts";
import type { WindowFrame } from "@svoverlay/ui-kit/window-chrome";

export interface SessionPickerOptions {
  logDirectory: string;
  stream: Extract<LogStream, "combat" | "rewards">;
  titleKey: MessageKey;
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
  let state: SessionPickerState = loadingState(options.titleKey);
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
        const managed = createManagedWindow({
          title: translate(options.titleKey),
          url: "views://sessionpickerview/index.html",
          rpc,
          minimum: { width: 480, height: 400 },
          placements: options.placementKey ? options.placements : undefined,
          placementKey: options.placementKey ?? "session-picker",
          defaultFrame: options.defaultFrame ?? { x: 120, y: 120, width: 640, height: 560 },
          onClose: () => {
            if (window === managed.window) window = undefined;
            paths.clear();
            state = loadingState(options.titleKey);
          },
        });
        window = managed.window;
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
    state = loadingState(options.titleKey);
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
          title: message(options.titleKey),
          status: "loading",
          statusDetail: countedMessage("sessions.scanning", items.length),
          sessions: items.slice(),
          canOpenLogFolder: options.openLogFolder !== undefined,
        };
        publish();
      }
      if (sequence !== refreshSequence) return;
      paths = nextPaths;
      state = {
        title: message(options.titleKey),
        status: "ready",
        statusDetail: items.length === 0 ? message("sessions.none") : countedMessage("sessions.recent", items.length),
        sessions: items,
        canOpenLogFolder: options.openLogFolder !== undefined,
      };
    } catch {
      if (sequence !== refreshSequence) return;
      paths.clear();
      state = { title: message(options.titleKey), status: "error", statusDetail: message("sessions.scanFailed"), sessions: [], canOpenLogFolder: options.openLogFolder !== undefined };
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

function loadingState(titleKey: MessageKey): SessionPickerState {
  return { title: message(titleKey), status: "loading", statusDetail: message("sessions.scanningRecent"), sessions: [], canOpenLogFolder: false };
}
