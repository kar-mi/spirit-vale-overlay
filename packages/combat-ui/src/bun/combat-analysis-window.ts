import path from "node:path";

import Electrobun, { BrowserView, BrowserWindow } from "electrobun/bun";
import { loadDpsReplay } from "@kar-mi/spirit-vale-tools-combat";
import type { FishNetDpsActorRow, FishNetDpsEncounterSnapshot, FishNetDpsSkillRow } from "@kar-mi/spirit-vale-tools-combat";
import { formatDuration } from "@spiritvale/ui-core/format";
import { applyRoundedCorners, setWindowIcon } from "@spiritvale/ui-core/win32";
import { appIconPath } from "@spiritvale/ui-core/window-publish";
import { registerUiScaleWindow, scaledSize } from "@spiritvale/ui-core/ui-scale";
import type { WindowPlacementStore } from "@spiritvale/ui-core/window-placement";

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
import { loadEnemyBreakdown } from "../enemy-breakdown.ts";
import type { EnemyBreakdownEncounter, EnemyDamageRow, EnemySkillStats } from "../enemy-breakdown.ts";
import { loadTpsReplay } from "../tps-replay.ts";
import { loadHpsReplay } from "../hps-replay.ts";
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
  placements?: WindowPlacementStore;
  onOpenSettings?: () => void;
  onStateChanged?: (state: CombatAnalysisState) => void;
}

/** Owns past-log analysis state plus the reusable live/past selected-player detail child. */
export function createCombatAnalysisController(options: CombatAnalysisControllerOptions = {}): CombatAnalysisController {
  let detailWindow: BrowserWindow | undefined;
  const deathLogWindow = createDeathLogWindow({
    placements: options.placements,
    placementKey: "combat-analysis-death-log",
    onOpenSettings: options.onOpenSettings,
  });
  let state: CombatAnalysisState = loadingState();
  let detailState: CombatAnalysisDetailState | undefined;
  let snapshots: FishNetDpsEncounterSnapshot[] = [];
  let enemyBreakdowns: EnemyBreakdownEncounter[] = [];
  let tpsSnapshots: MeterEncounterSnapshot[] = [];
  let healSnapshots: MeterEncounterSnapshot[] = [];
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
    snapshots = [];
    enemyBreakdowns = [];
    tpsSnapshots = [];
    healSnapshots = [];
    loadedPath = selectedPath;
    state = loadingState(path.basename(selectedPath), state.statType);
    publish();
    try {
      const replay = await loadDpsReplay(selectedPath);
      const nextSnapshots = replay.meter.getSnapshots();
      const nextEnemyBreakdowns = (await loadEnemyBreakdown(selectedPath, nextSnapshots)).encounters;
      const nextTpsSnapshots = (await loadTpsReplay(selectedPath, nextSnapshots)).snapshots;
      const nextHealSnapshots = (await loadHpsReplay(selectedPath, nextSnapshots)).snapshots;
      if (sequence !== loadSequence) return;
      snapshots = nextSnapshots;
      enemyBreakdowns = nextEnemyBreakdowns;
      tpsSnapshots = nextTpsSnapshots;
      healSnapshots = nextHealSnapshots;
      const selectedEncounterId = snapshots.at(-1)?.id;
      const lastSnapshot = snapshots.at(-1);
      state = {
        status: "ready",
        statusDetail: snapshots.length === 0 ? "This log contains no player damage." : `${snapshots.length} encounter${snapshots.length === 1 ? "" : "s"} loaded`,
        fileName: path.basename(selectedPath),
        invalidLines: replay.invalidLines,
        encounters: encounterOptions(snapshots),
        statType: state.statType,
        enemies: enemyBreakdownFor(selectedEncounterId)?.enemies ?? [],
        actorEnemyBreakdown: lastSnapshot && selectedEncounterId ? buildActorEnemyBreakdown(selectedEncounterId, lastSnapshot) : {},
        ...(selectedEncounterId === undefined ? {} : {
          selectedEncounterId,
          snapshot: lastSnapshot,
          tankedSnapshot: tpsSnapshotFor(selectedEncounterId),
          healSnapshot: healSnapshotFor(selectedEncounterId),
        }),
      };
      publish();
    } catch {
      if (sequence !== loadSequence) return;
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
      snapshots = [];
      enemyBreakdowns = [];
      tpsSnapshots = [];
      healSnapshots = [];
      publish();
      throw new Error("combat analysis log could not be loaded");
    }
  }

  function close(): void {
    loadSequence += 1;
    closeDetails();
    deathLogWindow.close();
    loadedPath = undefined;
  }

  function selectEncounter(id: string): CombatAnalysisState {
    if (state.snapshot?.id !== id && state.encounters.some((encounter) => encounter.id === id)) {
      closeDetails();
      const snapshot = selectedSnapshot(id);
      state = {
        ...state,
        selectedEncounterId: id,
        snapshot,
        tankedSnapshot: tpsSnapshotFor(id),
        healSnapshot: healSnapshotFor(id),
        enemies: enemyBreakdownFor(id)?.enemies ?? [],
        actorEnemyBreakdown: snapshot ? buildActorEnemyBreakdown(id, snapshot) : {},
      };
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
    if (!snapshot || !state.fileName) return;
    const tankedSnapshot = tpsSnapshotFor(snapshot.id);
    const healSnapshot = healSnapshotFor(snapshot.id);
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
    const breakdown = enemyBreakdownFor(snapshot.id);
    const skillsByEnemy = buildSkillsByEnemy(snapshot.id, player, snapshot.durationMs);
    const enemies = breakdown?.enemies.filter((enemy) => enemy.targetId in skillsByEnemy) ?? [];
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
    detailWindow = nextWindow;
    applyRoundedCorners(nextWindow.ptr);
    setWindowIcon(nextWindow.ptr, appIconPath);
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
        liveDetailActorId = undefined;
      }
    });
  }

  function closeDetails(): void {
    detailWindow?.close();
    detailWindow = undefined;
    detailState = undefined;
    liveDetailActorId = undefined;
  }

  async function openDeathLog(): Promise<void> {
    if (!state.fileName || !loadedPath) return;
    await deathLogWindow.open(loadedPath, false);
  }

  function selectedSnapshot(id: string): FishNetDpsEncounterSnapshot | undefined {
    return snapshots.find((snapshot) => snapshot.id === id);
  }

  function enemyBreakdownFor(encounterId: string | undefined): EnemyBreakdownEncounter | undefined {
    return encounterId === undefined ? undefined : enemyBreakdowns.find((entry) => entry.encounterId === encounterId);
  }

  function tpsSnapshotFor(encounterId: string | undefined): MeterEncounterSnapshot | undefined {
    return encounterId === undefined ? undefined : tpsSnapshots.find((snapshot) => snapshot.id === encounterId);
  }

  function healSnapshotFor(encounterId: string | undefined): MeterEncounterSnapshot | undefined {
    return encounterId === undefined ? undefined : healSnapshots.find((snapshot) => snapshot.id === encounterId);
  }

  function buildActorEnemyBreakdown(encounterId: string, snapshot: FishNetDpsEncounterSnapshot): Record<number, EnemyDamageRow[]> {
    const breakdown = enemyBreakdownFor(encounterId);
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

  function buildSkillsByEnemy(encounterId: string, player: FishNetDpsActorRow, durationMs: number): Record<number, FishNetDpsSkillRow[]> {
    const breakdown = enemyBreakdownFor(encounterId);
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

function encounterOptions(snapshots: readonly FishNetDpsEncounterSnapshot[]): DpsEncounterOption[] {
  return snapshots.map((encounter, index) => ({
    id: encounter.id,
    label: `Encounter ${index + 1} · ${formatDuration(encounter.durationMs)}`,
  }));
}
