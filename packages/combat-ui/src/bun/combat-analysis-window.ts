import path from "node:path";

import Electrobun, { BrowserView, BrowserWindow } from "electrobun/bun";
import { loadDpsReplay } from "@kar-mi/spirit-vale-tools-combat";
import type { FishNetDpsEncounterSnapshot } from "@kar-mi/spirit-vale-tools-combat";
import { formatDuration } from "@spiritvale/ui-core/format";
import { applyRoundedCorners } from "@spiritvale/ui-core/win32";
import { registerUiScaleWindow, scaledSize } from "@spiritvale/ui-core/ui-scale";
import type { WindowPlacementStore } from "@spiritvale/ui-core/window-placement";

import type {
  CombatAnalysisDetailRpc,
  CombatAnalysisDetailState,
  CombatAnalysisRpc,
  CombatAnalysisState,
  DpsEncounterOption,
} from "../app-types.ts";

const ANALYSIS_FRAME = { x: 140, y: 120, width: 920, height: 680 };
const DETAIL_FRAME = { x: 190, y: 160, width: 880, height: 720 };
const MINIMUM_ANALYSIS_WIDTH = 680;
const MINIMUM_ANALYSIS_HEIGHT = 460;
const MINIMUM_DETAIL_WIDTH = 620;
const MINIMUM_DETAIL_HEIGHT = 500;

export interface CombatAnalysisWindow {
  open(path: string): Promise<void>;
  close(): void;
}

export interface CombatAnalysisWindowOptions {
  placements?: WindowPlacementStore;
}

/** Owns the reusable combat log analysis window and its selected-player detail child. */
export function createCombatAnalysisWindow(options: CombatAnalysisWindowOptions = {}): CombatAnalysisWindow {
  let window: BrowserWindow | undefined;
  let detailWindow: BrowserWindow | undefined;
  let state: CombatAnalysisState = loadingState();
  let detailState: CombatAnalysisDetailState | undefined;
  let snapshots: FishNetDpsEncounterSnapshot[] = [];

  const detailRpc = BrowserView.defineRPC<CombatAnalysisDetailRpc>({
    handlers: {
      requests: {
        getState: () => {
          if (!detailState) throw new Error("No player detail is selected");
          return detailState;
        },
        windowAction: ({ action }) => {
          if (action === "minimize") detailWindow?.minimize();
          else detailWindow?.close();
        },
        getWindowFrame: () => detailWindow?.getFrame()
          ?? options.placements?.frame(
            "combat-analysis-detail",
            DETAIL_FRAME,
            { width: MINIMUM_DETAIL_WIDTH, height: MINIMUM_DETAIL_HEIGHT },
          )
          ?? DETAIL_FRAME,
        setWindowFrame: (frame) => detailWindow?.setFrame(
          frame.x,
          frame.y,
          Math.max(scaledSize(MINIMUM_DETAIL_WIDTH), frame.width),
          Math.max(scaledSize(MINIMUM_DETAIL_HEIGHT), frame.height),
        ),
      },
      messages: {},
    },
  });

  const rpc = BrowserView.defineRPC<CombatAnalysisRpc>({
    handlers: {
      requests: {
        getState: () => state,
        selectEncounter: ({ id }) => {
          if (state.snapshot?.id !== id && state.encounters.some((encounter) => encounter.id === id)) {
            detailWindow?.close();
            detailState = undefined;
            state = { ...state, selectedEncounterId: id, snapshot: selectedSnapshot(id) };
            publish();
          }
          return state;
        },
        openPlayerDetails: ({ actorId }) => { openPlayerDetails(actorId); },
        windowAction: ({ action }) => {
          if (action === "minimize") window?.minimize();
          else window?.close();
        },
        getWindowFrame: () => window?.getFrame()
          ?? options.placements?.frame(
            "combat-analysis",
            ANALYSIS_FRAME,
            { width: MINIMUM_ANALYSIS_WIDTH, height: MINIMUM_ANALYSIS_HEIGHT },
          )
          ?? ANALYSIS_FRAME,
        setWindowFrame: (frame) => window?.setFrame(
          frame.x,
          frame.y,
          Math.max(scaledSize(MINIMUM_ANALYSIS_WIDTH), frame.width),
          Math.max(scaledSize(MINIMUM_ANALYSIS_HEIGHT), frame.height),
        ),
      },
      messages: {},
    },
  });

  return { open, close };

  async function open(selectedPath: string): Promise<void> {
    ensureWindow();
    window?.show();
    window?.activate();
    detailWindow?.close();
    detailState = undefined;
    snapshots = [];
    state = loadingState(path.basename(selectedPath));
    publish();
    try {
      const replay = await loadDpsReplay(selectedPath);
      snapshots = replay.meter.getSnapshots();
      const selectedEncounterId = snapshots.at(-1)?.id;
      state = {
        status: "ready",
        statusDetail: snapshots.length === 0 ? "This log contains no player damage." : `${snapshots.length} encounter${snapshots.length === 1 ? "" : "s"} loaded`,
        fileName: path.basename(selectedPath),
        invalidLines: replay.invalidLines,
        encounters: encounterOptions(snapshots),
        ...(selectedEncounterId === undefined ? {} : { selectedEncounterId, snapshot: snapshots.at(-1) }),
      };
      publish();
    } catch {
      state = {
        status: "error",
        statusDetail: "The selected combat log could not be read.",
        fileName: path.basename(selectedPath),
        invalidLines: 0,
        encounters: [],
      };
      snapshots = [];
      publish();
      throw new Error("combat analysis log could not be loaded");
    }
  }

  function close(): void {
    detailWindow?.close();
    detailWindow = undefined;
    detailState = undefined;
    window?.close();
    window = undefined;
  }

  function ensureWindow(): void {
    if (window) return;
    const nextWindow = new BrowserWindow({
      title: "Spirit Vale Combat Analysis",
      url: "views://analysisview/index.html",
      frame: options.placements?.frame(
        "combat-analysis",
        ANALYSIS_FRAME,
        { width: MINIMUM_ANALYSIS_WIDTH, height: MINIMUM_ANALYSIS_HEIGHT },
      ) ?? ANALYSIS_FRAME,
      titleBarStyle: "hidden",
      transparent: false,
      rpc,
    });
    window = nextWindow;
    applyRoundedCorners(nextWindow.ptr);
    registerUiScaleWindow(nextWindow, { scaleInitialFrame: !options.placements });
    options.placements?.track("combat-analysis", nextWindow);
    Electrobun.events.on(`resize-${nextWindow.id}`, (event: { data: { width: number; height: number } }) => {
      const width = Math.max(scaledSize(MINIMUM_ANALYSIS_WIDTH), event.data.width);
      const height = Math.max(scaledSize(MINIMUM_ANALYSIS_HEIGHT), event.data.height);
      if (width !== event.data.width || height !== event.data.height) nextWindow.setSize(width, height);
    });
    nextWindow.on("close", () => {
      if (window !== nextWindow) return;
      detailWindow?.close();
      detailWindow = undefined;
      detailState = undefined;
      window = undefined;
    });
  }

  function openPlayerDetails(actorId: number): void {
    const snapshot = state.snapshot;
    const player = snapshot?.actors.find((actor) => actor.actorIds.includes(actorId));
    if (!snapshot || !player || !state.fileName) return;
    detailState = {
      fileName: state.fileName,
      encounterLabel: state.encounters.find((encounter) => encounter.id === snapshot.id)?.label ?? "Encounter",
      encounterDurationMs: snapshot.durationMs,
      player,
    };
    if (detailWindow) {
      publishDetail();
      detailWindow.show();
      detailWindow.activate();
      return;
    }
    const nextWindow = new BrowserWindow({
      title: `${player.displayName} · Combat Analysis`,
      url: "views://analysisdetailview/index.html",
      frame: options.placements?.frame(
        "combat-analysis-detail",
        DETAIL_FRAME,
        { width: MINIMUM_DETAIL_WIDTH, height: MINIMUM_DETAIL_HEIGHT },
      ) ?? DETAIL_FRAME,
      titleBarStyle: "hidden",
      transparent: false,
      rpc: detailRpc,
    });
    detailWindow = nextWindow;
    applyRoundedCorners(nextWindow.ptr);
    registerUiScaleWindow(nextWindow, { scaleInitialFrame: !options.placements });
    options.placements?.track("combat-analysis-detail", nextWindow);
    Electrobun.events.on(`resize-${nextWindow.id}`, (event: { data: { width: number; height: number } }) => {
      const width = Math.max(scaledSize(MINIMUM_DETAIL_WIDTH), event.data.width);
      const height = Math.max(scaledSize(MINIMUM_DETAIL_HEIGHT), event.data.height);
      if (width !== event.data.width || height !== event.data.height) nextWindow.setSize(width, height);
    });
    nextWindow.on("close", () => {
      if (detailWindow === nextWindow) {
        detailWindow = undefined;
        detailState = undefined;
      }
    });
  }

  function selectedSnapshot(id: string): FishNetDpsEncounterSnapshot | undefined {
    return snapshots.find((snapshot) => snapshot.id === id);
  }

  function publish(): void {
    try { rpc.send.stateChanged(state); } catch { /* The view may still be connecting. */ }
  }

  function publishDetail(): void {
    if (!detailState) return;
    try { detailRpc.send.stateChanged(detailState); } catch { /* The view may still be connecting. */ }
  }
}

function loadingState(fileName?: string): CombatAnalysisState {
  return {
    status: "loading",
    statusDetail: "Loading combat log…",
    ...(fileName === undefined ? {} : { fileName }),
    invalidLines: 0,
    encounters: [],
  };
}

function encounterOptions(snapshots: readonly FishNetDpsEncounterSnapshot[]): DpsEncounterOption[] {
  return snapshots.map((encounter, index) => ({
    id: encounter.id,
    label: `Encounter ${index + 1} · ${formatDuration(encounter.durationMs)}`,
  }));
}
