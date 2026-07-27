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
  CombatDeathLogRpc,
  CombatDeathLogState,
  CombatAnalysisRpc,
  CombatAnalysisState,
  DpsEncounterOption,
} from "../app-types.ts";
import { loadDeathLogReplay } from "../death-log.ts";
import { loadEnemyBreakdown } from "../enemy-breakdown.ts";
import type { EnemyBreakdownEncounter, EnemyDamageRow, EnemySkillStats } from "../enemy-breakdown.ts";

const ANALYSIS_FRAME = { x: 140, y: 120, width: 920, height: 680 };
const DETAIL_FRAME = { x: 190, y: 160, width: 880, height: 720 };
const DEATH_LOG_FRAME = { x: 220, y: 180, width: 900, height: 680 };
const MINIMUM_ANALYSIS_WIDTH = 680;
const MINIMUM_ANALYSIS_HEIGHT = 460;
const MINIMUM_DETAIL_WIDTH = 620;
const MINIMUM_DETAIL_HEIGHT = 500;
const MINIMUM_DEATH_LOG_WIDTH = 680;
const MINIMUM_DEATH_LOG_HEIGHT = 500;

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
  let deathLogWindow: BrowserWindow | undefined;
  let state: CombatAnalysisState = loadingState();
  let detailState: CombatAnalysisDetailState | undefined;
  let deathLogState: CombatDeathLogState | undefined;
  let snapshots: FishNetDpsEncounterSnapshot[] = [];
  let enemyBreakdowns: EnemyBreakdownEncounter[] = [];
  let loadedPath: string | undefined;

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

  const deathLogRpc = BrowserView.defineRPC<CombatDeathLogRpc>({
    handlers: {
      requests: {
        getState: () => {
          if (!deathLogState) throw new Error("No death log is loaded");
          return deathLogState;
        },
        selectDeath: ({ id }) => {
          if (deathLogState?.deaths.some((death) => death.id === id)) {
            deathLogState = { ...deathLogState, selectedDeathId: id };
            publishDeathLog();
          }
          if (!deathLogState) throw new Error("No death log is loaded");
          return deathLogState;
        },
        windowAction: ({ action }) => {
          if (action === "minimize") deathLogWindow?.minimize();
          else deathLogWindow?.close();
        },
        getWindowFrame: () => deathLogWindow?.getFrame()
          ?? options.placements?.frame("combat-death-log", DEATH_LOG_FRAME, { width: MINIMUM_DEATH_LOG_WIDTH, height: MINIMUM_DEATH_LOG_HEIGHT })
          ?? DEATH_LOG_FRAME,
        setWindowFrame: (frame) => deathLogWindow?.setFrame(
          frame.x,
          frame.y,
          Math.max(scaledSize(MINIMUM_DEATH_LOG_WIDTH), frame.width),
          Math.max(scaledSize(MINIMUM_DEATH_LOG_HEIGHT), frame.height),
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
            const snapshot = selectedSnapshot(id);
            state = {
              ...state,
              selectedEncounterId: id,
              snapshot,
              enemies: enemyBreakdownFor(id)?.enemies ?? [],
              actorEnemyBreakdown: snapshot ? buildActorEnemyBreakdown(id, snapshot) : {},
            };
            publish();
          }
          return state;
        },
        openPlayerDetails: ({ actorId }) => { openPlayerDetails(actorId); },
        openDeathLog: async () => { await openDeathLog(); },
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
    deathLogWindow?.close();
    detailState = undefined;
    deathLogState = undefined;
    snapshots = [];
    enemyBreakdowns = [];
    loadedPath = selectedPath;
    state = loadingState(path.basename(selectedPath));
    publish();
    try {
      const replay = await loadDpsReplay(selectedPath);
      snapshots = replay.meter.getSnapshots();
      enemyBreakdowns = (await loadEnemyBreakdown(selectedPath, snapshots)).encounters;
      const selectedEncounterId = snapshots.at(-1)?.id;
      const lastSnapshot = snapshots.at(-1);
      state = {
        status: "ready",
        statusDetail: snapshots.length === 0 ? "This log contains no player damage." : `${snapshots.length} encounter${snapshots.length === 1 ? "" : "s"} loaded`,
        fileName: path.basename(selectedPath),
        invalidLines: replay.invalidLines,
        encounters: encounterOptions(snapshots),
        enemies: enemyBreakdownFor(selectedEncounterId)?.enemies ?? [],
        actorEnemyBreakdown: lastSnapshot && selectedEncounterId ? buildActorEnemyBreakdown(selectedEncounterId, lastSnapshot) : {},
        ...(selectedEncounterId === undefined ? {} : { selectedEncounterId, snapshot: lastSnapshot }),
      };
      publish();
    } catch {
      state = {
        status: "error",
        statusDetail: "The selected combat log could not be read.",
        fileName: path.basename(selectedPath),
        invalidLines: 0,
        encounters: [],
        enemies: [],
        actorEnemyBreakdown: {},
      };
      snapshots = [];
      enemyBreakdowns = [];
      publish();
      throw new Error("combat analysis log could not be loaded");
    }
  }

  function close(): void {
    detailWindow?.close();
    deathLogWindow?.close();
    detailWindow = undefined;
    deathLogWindow = undefined;
    detailState = undefined;
    deathLogState = undefined;
    loadedPath = undefined;
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
    setWindowIcon(nextWindow.ptr, appIconPath);
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
      deathLogWindow?.close();
      detailWindow = undefined;
      deathLogWindow = undefined;
      detailState = undefined;
      deathLogState = undefined;
      loadedPath = undefined;
      window = undefined;
    });
  }

  function openPlayerDetails(actorId: number): void {
    const snapshot = state.snapshot;
    const player = snapshot?.actors.find((actor) => actor.actorIds.includes(actorId));
    if (!snapshot || !player || !state.fileName) return;
    const breakdown = enemyBreakdownFor(snapshot.id);
    const skillsByEnemy = buildSkillsByEnemy(snapshot.id, player, snapshot.durationMs);
    detailState = {
      fileName: state.fileName,
      encounterLabel: state.encounters.find((encounter) => encounter.id === snapshot.id)?.label ?? "Encounter",
      encounterDurationMs: snapshot.durationMs,
      player,
      enemies: breakdown?.enemies.filter((enemy) => enemy.targetId in skillsByEnemy) ?? [],
      skillsByEnemy,
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
      }
    });
  }

  async function openDeathLog(): Promise<void> {
    if (!state.fileName || !loadedPath) return;
    const replay = await loadDeathLogReplay(loadedPath);
    deathLogState = {
      fileName: state.fileName,
      deaths: replay.deaths,
      invalidLines: replay.invalidLines,
      ...(replay.deaths[0] === undefined ? {} : { selectedDeathId: replay.deaths[0].id }),
    };
    if (deathLogWindow) {
      publishDeathLog();
      deathLogWindow.show();
      deathLogWindow.activate();
      return;
    }
    const nextWindow = new BrowserWindow({
      title: "Combat Death Log",
      url: "views://deathlogview/index.html",
      frame: options.placements?.frame("combat-death-log", DEATH_LOG_FRAME, { width: MINIMUM_DEATH_LOG_WIDTH, height: MINIMUM_DEATH_LOG_HEIGHT }) ?? DEATH_LOG_FRAME,
      titleBarStyle: "hidden",
      transparent: false,
      rpc: deathLogRpc,
    });
    deathLogWindow = nextWindow;
    applyRoundedCorners(nextWindow.ptr);
    setWindowIcon(nextWindow.ptr, appIconPath);
    registerUiScaleWindow(nextWindow, { scaleInitialFrame: !options.placements });
    options.placements?.track("combat-death-log", nextWindow);
    Electrobun.events.on(`resize-${nextWindow.id}`, (event: { data: { width: number; height: number } }) => {
      const width = Math.max(scaledSize(MINIMUM_DEATH_LOG_WIDTH), event.data.width);
      const height = Math.max(scaledSize(MINIMUM_DEATH_LOG_HEIGHT), event.data.height);
      if (width !== event.data.width || height !== event.data.height) nextWindow.setSize(width, height);
    });
    nextWindow.on("close", () => {
      if (deathLogWindow === nextWindow) deathLogWindow = undefined;
    });
  }

  function selectedSnapshot(id: string): FishNetDpsEncounterSnapshot | undefined {
    return snapshots.find((snapshot) => snapshot.id === id);
  }

  function enemyBreakdownFor(encounterId: string | undefined): EnemyBreakdownEncounter | undefined {
    return encounterId === undefined ? undefined : enemyBreakdowns.find((entry) => entry.encounterId === encounterId);
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
    try { rpc.send.stateChanged(state); } catch { /* The view may still be connecting. */ }
  }

  function publishDetail(): void {
    if (!detailState) return;
    try { detailRpc.send.stateChanged(detailState); } catch { /* The view may still be connecting. */ }
  }

  function publishDeathLog(): void {
    if (!deathLogState) return;
    try { deathLogRpc.send.stateChanged(deathLogState); } catch { /* The view may still be connecting. */ }
  }
}

function loadingState(fileName?: string): CombatAnalysisState {
  return {
    status: "loading",
    statusDetail: "Loading combat log…",
    ...(fileName === undefined ? {} : { fileName }),
    invalidLines: 0,
    encounters: [],
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
