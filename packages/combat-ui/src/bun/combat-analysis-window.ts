import path from "node:path";

import { BrowserView, BrowserWindow } from "electrobun/bun";
import { loadDpsReplay } from "@kar-mi/spirit-vale-tools-combat";
import type { CombatHistoryStore, FishNetDpsActorRow, FishNetDpsEncounterSnapshot, FishNetDpsSkillRow } from "@kar-mi/spirit-vale-tools-combat";
import { formatDuration } from "@spiritvale/ui-core/format";
import { applyRoundedCorners, setWindowIcon } from "@spiritvale/ui-core/win32";
import { appIconPath } from "@spiritvale/ui-core/window-publish";
import { registerUiScaleWindow, scaledSize } from "@spiritvale/ui-core/ui-scale-window";
import type { WindowPlacementStore } from "@spiritvale/ui-core/window-placement";
import { DisposableStore, onWindowEvent, onceWindowEvent } from "@spiritvale/ui-core/window-lifecycle";

import type {
  CombatAnalysisDetailRpc,
  CombatAnalysisDetailState,
  CombatAnalysisState,
  DpsEncounterOption,
  MeterActorRow,
  MeterEncounterSnapshot,
  StatType,
} from "../app-types.ts";
import { createDeathLogWindow } from "./death-log-window.ts";
import type { EnemyDamageRow, EnemySkillStats } from "../enemy-breakdown.ts";
import { indexCombatSession, loadIndexedEncounter } from "../combat-history.ts";
import type { CombatReadModelSource, IndexedEncounter, IndexedEncounterSummary } from "../combat-history.ts";
import { managedSessionId } from "@spiritvale/ui-core/managed-session";
import { validSelectedEnemyIds } from "../analysis-selection.ts";
import { buildLivePlayerDetailState, emptyDpsRow } from "../live-player-detail.ts";

const DETAIL_FRAME = { x: 190, y: 160, width: 1166, height: 720 };
const MINIMUM_DETAIL_WIDTH = 620;
const MINIMUM_DETAIL_HEIGHT = 500;

export interface CombatAnalysisController {
  open(path: string): Promise<void>;
  close(): void;
  getState(): CombatAnalysisState;
  selectEncounter(id: string): CombatAnalysisState;
  setStatType(statType: StatType): CombatAnalysisState;
  openPlayerDetails(actorId: number, selectedEnemyIds: readonly number[]): void;
  openLivePlayerDetails(input: LivePlayerDetailInput): void;
  refreshLivePlayerDetails(input: LivePlayerDetailRefresh): void;
  closeDetails(): void;
  openDeathLog(): Promise<void>;
}

export interface LivePlayerDetailInput extends LivePlayerDetailRefresh {
  actorId: number;
}

export interface LivePlayerDetailRefresh {
  fileName: string;
  snapshot?: FishNetDpsEncounterSnapshot;
  tankedSnapshot?: MeterEncounterSnapshot;
  healSnapshot?: MeterEncounterSnapshot;
  statType: StatType;
}

export interface CombatAnalysisControllerOptions {
  logDirectory?: string;
  /** Managed session logs are read from here; anything else falls back to replaying the file. */
  readModel?: CombatReadModelSource;
  placements?: WindowPlacementStore;
  onOpenSettings?: () => void;
  onStateChanged?: (state: CombatAnalysisState) => void;
}

/** Encounters listed per log. Matches the session picker's cap on how far back the UI looks. */
const MAX_ENCOUNTERS = 500;

/** Owns past-log analysis state plus the reusable live/past selected-player detail child. */
export function createCombatAnalysisController(options: CombatAnalysisControllerOptions = {}): CombatAnalysisController {
  let detailWindow: BrowserWindow | undefined;
  let detailLifecycle: DisposableStore | undefined;
  const deathLogWindow = createDeathLogWindow({
    ...(options.logDirectory === undefined ? {} : { logDirectory: options.logDirectory }),
    ...(options.readModel === undefined ? {} : { readModel: options.readModel }),
    placements: options.placements,
    placementKey: "combat-analysis-death-log",
    onOpenSettings: options.onOpenSettings,
  });
  let state: CombatAnalysisState = loadingState();
  let detailState: CombatAnalysisDetailState | undefined;
  // Only the selected encounter is resident. Everything else is a list of ids and durations, and the
  // encounter itself is re-read from the index whenever the selection changes.
  let encounters: IndexedEncounterSummary[] = [];
  let selected: IndexedEncounter | undefined;
  let store: CombatHistoryStore | undefined;
  let sessionId: string | undefined;
  // Populated only on the fallback path, for a log outside the managed directory.
  let replayEncounters: IndexedEncounter[] = [];
  let loadedPath: string | undefined;
  let liveDetailActorId: number | undefined;
  let loadSequence = 0;

  const detailRpc = BrowserView.defineRPC<CombatAnalysisDetailRpc>({
    handlers: {
      requests: {
        getState: () => {
          if (!detailState) throw new Error("No player detail is selected");
          return detailState;
        },
        openSettings: () => { options.onOpenSettings?.(); },
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

  return {
    open,
    close,
    getState: () => state,
    selectEncounter,
    setStatType,
    openPlayerDetails,
    openLivePlayerDetails,
    refreshLivePlayerDetails,
    closeDetails,
    openDeathLog,
  };

  async function open(selectedPath: string): Promise<void> {
    const sequence = ++loadSequence;
    closeDetails();
    deathLogWindow.close();
    clearLoaded();
    loadedPath = selectedPath;
    state = loadingState(path.basename(selectedPath), state.statType);
    publish();
    try {
      const invalidLines = await load(selectedPath);
      if (sequence !== loadSequence) return;
      const count = encounters.length;
      const lastId = encounters.at(-1)?.encounterId;
      state = {
        status: "ready",
        statusDetail: count === 0 ? "This log contains no player damage." : `${count} encounter${count === 1 ? "" : "s"} loaded`,
        fileName: path.basename(selectedPath),
        invalidLines,
        encounters: encounterOptions(encounters),
        statType: state.statType,
        enemies: [],
        actorEnemyBreakdown: {},
      };
      if (lastId) applySelection(lastId);
      publish();
    } catch {
      if (sequence !== loadSequence) return;
      clearLoaded();
      state = {
        status: "error",
        statusDetail: "The selected combat log could not be read.",
        fileName: path.basename(selectedPath),
        invalidLines: 0,
        encounters: [],
        statType: state.statType,
        enemies: [],
        actorEnemyBreakdown: {},
      };
      publish();
      throw new Error("combat analysis log could not be loaded");
    }
  }

  /**
   * Indexes the log and lists its encounters, or replays it when it is not a managed session log.
   * Returns the count of unparseable lines, which only the replay path can report.
   */
  async function load(selectedPath: string): Promise<number> {
    const id = options.logDirectory === undefined
      ? undefined
      : managedSessionId(selectedPath, "combat", options.logDirectory);
    if (id !== undefined) {
      const indexed = await indexCombatSession(options.readModel, id, MAX_ENCOUNTERS);
      if (indexed) {
        sessionId = id;
        store = indexed.store;
        encounters = indexed.encounters;
        return 0;
      }
    }
    const replay = await loadDpsReplay(selectedPath);
    // Without an index the whole log is in memory anyway, so keep the rendered encounters rather
    // than re-reading the file per selection. Tanked, healing and the enemy breakdown come from the
    // index only, so those tabs stay empty for a log outside the managed directory.
    replayEncounters = replay.meter.getSnapshots().map((snapshot) => ({
      snapshot,
      breakdown: { encounterId: snapshot.id, enemies: [], bySkill: new Map() },
    }));
    encounters = replayEncounters.map((entry) => ({
      encounterId: entry.snapshot.id,
      durationMs: entry.snapshot.durationMs,
    }));
    return replay.invalidLines;
  }

  function loadEncounter(encounterId: string): IndexedEncounter | undefined {
    if (store && sessionId !== undefined) return loadIndexedEncounter(store, sessionId, encounterId);
    return replayEncounters.find((entry) => entry.snapshot.id === encounterId);
  }

  /** Reads one encounter in and folds it into the published state. */
  function applySelection(encounterId: string): void {
    selected = loadEncounter(encounterId);
    if (!selected) {
      state = { ...state, selectedEncounterId: encounterId, enemies: [], actorEnemyBreakdown: {} };
      return;
    }
    state = {
      ...state,
      selectedEncounterId: encounterId,
      snapshot: selected.snapshot,
      ...(selected.tankedSnapshot === undefined ? {} : { tankedSnapshot: selected.tankedSnapshot }),
      ...(selected.healSnapshot === undefined ? {} : { healSnapshot: selected.healSnapshot }),
      enemies: selected.breakdown.enemies,
      actorEnemyBreakdown: buildActorEnemyBreakdown(selected.snapshot),
    };
  }

  function clearLoaded(): void {
    encounters = [];
    replayEncounters = [];
    selected = undefined;
    store = undefined;
    sessionId = undefined;
  }

  function close(): void {
    loadSequence += 1;
    closeDetails();
    deathLogWindow.close();
    clearLoaded();
    loadedPath = undefined;
    state = loadingState(undefined, state.statType);
  }

  function selectEncounter(id: string): CombatAnalysisState {
    if (state.selectedEncounterId !== id && state.encounters.some((encounter) => encounter.id === id)) {
      closeDetails();
      applySelection(id);
      publish();
    }
    return state;
  }

  function setStatType(statType: StatType): CombatAnalysisState {
    state = { ...state, statType };
    publish();
    return state;
  }

  function openPlayerDetails(actorId: number, selectedEnemyIds: readonly number[]): void {
    liveDetailActorId = undefined;
    const snapshot = state.snapshot;
    if (!snapshot || !state.fileName || !selected) return;
    const tankedSnapshot = selected.tankedSnapshot;
    const healSnapshot = selected.healSnapshot;
    const dpsPlayer = snapshot.actors.find((actor) => actor.actorIds.includes(actorId));
    const tankedPlayer = tankedSnapshot?.actors.find((actor) => actor.actorIds.includes(actorId));
    const healPlayer = healSnapshot?.actors.find((actor) => actor.actorIds.includes(actorId));
    // A player who never dealt damage (a dedicated healer/tank) has no row in the DPS
    // snapshot — double-clicking them from the HPS/TPS tab must still open the detail
    // window, using whichever row we do have for identity and a zero-value DPS row so
    // the "damage" tab still renders instead of the window failing to open at all.
    const identity = dpsPlayer ?? tankedPlayer ?? healPlayer;
    if (!identity) return;
    const player = dpsPlayer ?? emptyDpsRow(identity, snapshot.durationMs);
    const skillsByEnemy = buildSkillsByEnemy(player, snapshot.durationMs);
    const enemies = selected.breakdown.enemies.filter((enemy) => enemy.targetId in skillsByEnemy);
    detailState = {
      fileName: state.fileName,
      encounterLabel: state.encounters.find((encounter) => encounter.id === snapshot.id)?.label ?? "Encounter",
      encounterDurationMs: snapshot.durationMs,
      statType: state.statType,
      selectedEnemyIds: validSelectedEnemyIds(selectedEnemyIds, new Set(enemies.map((enemy) => enemy.targetId))),
      player,
      tankedPlayer,
      healPlayer,
      enemies,
      skillsByEnemy,
    };
    showDetailWindow(identity);
  }

  function openLivePlayerDetails(input: LivePlayerDetailInput): void {
    liveDetailActorId = input.actorId;
    if (!setLiveDetailState(input, input.actorId)) {
      liveDetailActorId = undefined;
      return;
    }
    const identity = input.snapshot?.actors.find((actor) => actor.actorIds.includes(input.actorId))
      ?? input.tankedSnapshot?.actors.find((actor) => actor.actorIds.includes(input.actorId))
      ?? input.healSnapshot?.actors.find((actor) => actor.actorIds.includes(input.actorId));
    if (identity) showDetailWindow(identity);
  }

  function refreshLivePlayerDetails(input: LivePlayerDetailRefresh): void {
    if (liveDetailActorId === undefined || !detailWindow) return;
    if (!setLiveDetailState(input, liveDetailActorId)) {
      closeDetails();
      return;
    }
    publishDetail();
  }

  function setLiveDetailState(input: LivePlayerDetailRefresh, actorId: number): boolean {
    const next = buildLivePlayerDetailState(input, actorId);
    if (!next) return false;
    detailState = next;
    return true;
  }

  function showDetailWindow(identity: FishNetDpsActorRow | MeterActorRow): void {
    if (detailWindow) {
      publishDetail();
      detailWindow.show();
      detailWindow.activate();
      return;
    }
    const nextWindow = new BrowserWindow({
      title: `${identity.displayName} · Combat Analysis`,
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
    const lifecycle = new DisposableStore();
    detailWindow = nextWindow;
    detailLifecycle = lifecycle;
    applyRoundedCorners(nextWindow.ptr);
    setWindowIcon(nextWindow.ptr, appIconPath);
    lifecycle.add(registerUiScaleWindow(nextWindow, { scaleInitialFrame: !options.placements }));
    const disposePlacement = options.placements?.track("combat-analysis-detail", nextWindow);
    if (disposePlacement) lifecycle.add(disposePlacement);
    lifecycle.add(onWindowEvent(nextWindow, "resize", (event: { data: { width: number; height: number } }) => {
      const width = Math.max(scaledSize(MINIMUM_DETAIL_WIDTH), event.data.width);
      const height = Math.max(scaledSize(MINIMUM_DETAIL_HEIGHT), event.data.height);
      if (width !== event.data.width || height !== event.data.height) nextWindow.setSize(width, height);
    }));
    lifecycle.add(onceWindowEvent(nextWindow, "close", () => {
      lifecycle.dispose();
      if (detailWindow === nextWindow) {
        detailWindow = undefined;
        detailLifecycle = undefined;
        detailState = undefined;
        liveDetailActorId = undefined;
      }
    }));
  }

  function closeDetails(): void {
    detailLifecycle?.dispose();
    detailWindow?.close();
    detailWindow = undefined;
    detailLifecycle = undefined;
    detailState = undefined;
    liveDetailActorId = undefined;
  }

  async function openDeathLog(): Promise<void> {
    if (!state.fileName || !loadedPath) return;
    await deathLogWindow.open(loadedPath, false);
  }

  function buildActorEnemyBreakdown(snapshot: FishNetDpsEncounterSnapshot): Record<number, EnemyDamageRow[]> {
    const breakdown = selected?.breakdown;
    const result: Record<number, EnemyDamageRow[]> = {};
    if (!breakdown) return result;
    for (const actor of snapshot.actors) {
      const byTarget = new Map<number, EnemyDamageRow>();
      for (const actorId of actor.actorIds) {
        const targets = breakdown.bySkill.get(actorId);
        if (!targets) continue;
        for (const [targetId, skills] of targets) {
          const row = byTarget.get(targetId) ?? { targetId, damage: 0, hits: 0, criticalHits: 0 };
          for (const stats of skills.values()) {
            row.damage += stats.damage;
            row.hits += stats.hits;
            row.criticalHits += stats.criticalHits;
          }
          byTarget.set(targetId, row);
        }
      }
      result[actor.actorIds[0]!] = [...byTarget.values()];
    }
    return result;
  }

  function buildSkillsByEnemy(player: FishNetDpsActorRow, durationMs: number): Record<number, FishNetDpsSkillRow[]> {
    const breakdown = selected?.breakdown;
    const result: Record<number, FishNetDpsSkillRow[]> = {};
    if (!breakdown) return result;
    const durationSeconds = Math.max(1, durationMs) / 1000;
    const byTarget = new Map<number, Map<string, EnemySkillStats>>();
    for (const actorId of player.actorIds) {
      const targets = breakdown.bySkill.get(actorId);
      if (!targets) continue;
      for (const [targetId, skills] of targets) {
        const merged = byTarget.get(targetId) ?? new Map<string, EnemySkillStats>();
        for (const [sourceId, stats] of skills) {
          const existing = merged.get(sourceId) ?? { sourceLabel: stats.sourceLabel, damage: 0, hits: 0, criticalHits: 0 };
          existing.damage += stats.damage;
          existing.hits += stats.hits;
          existing.criticalHits += stats.criticalHits;
          merged.set(sourceId, existing);
        }
        byTarget.set(targetId, merged);
      }
    }
    for (const [targetId, merged] of byTarget) {
      const totalDamage = [...merged.values()].reduce((sum, stats) => sum + stats.damage, 0);
      const rows: FishNetDpsSkillRow[] = [...merged.entries()]
        .map(([sourceId, stats]) => ({
          sourceId,
          sourceLabel: stats.sourceLabel,
          damage: stats.damage,
          dps: stats.damage / durationSeconds,
          contribution: totalDamage > 0 ? stats.damage / totalDamage : 0,
          hits: stats.hits,
          criticalHits: stats.criticalHits,
          ...(stats.hits > 0 ? { critRate: stats.criticalHits / stats.hits } : {}),
        }))
        .sort((left, right) => right.damage - left.damage);
      result[targetId] = rows;
    }
    return result;
  }

  function publish(): void {
    options.onStateChanged?.(state);
  }

  function publishDetail(): void {
    if (!detailState) return;
    try { detailRpc.send.stateChanged(detailState); } catch { /* The view may still be connecting. */ }
  }

}

function loadingState(fileName?: string, statType: StatType = "damage"): CombatAnalysisState {
  return {
    status: "loading",
    statusDetail: "Loading combat log…",
    ...(fileName === undefined ? {} : { fileName }),
    invalidLines: 0,
    encounters: [],
    statType,
    enemies: [],
    actorEnemyBreakdown: {},
  };
}

function encounterOptions(summaries: readonly IndexedEncounterSummary[]): DpsEncounterOption[] {
  return summaries.map((encounter, index) => ({
    id: encounter.encounterId,
    label: `Encounter ${index + 1} · ${formatDuration(encounter.durationMs)}`,
  }));
}
