import type {
  CombatAnalysisDetailState,
  MeterActorRow,
  MeterEncounterSnapshot,
  StatType,
} from "./app-types.ts";

export interface LiveDetailSnapshots {
  fileName: string;
  snapshot?: { durationMs: number; actors: MeterActorRow[] };
  tankedSnapshot?: MeterEncounterSnapshot;
  healSnapshot?: MeterEncounterSnapshot;
  statType: StatType;
}

export function buildLivePlayerDetailState(
  input: LiveDetailSnapshots,
  actorId: number,
): CombatAnalysisDetailState | undefined {
  const dpsPlayer = input.snapshot?.actors.find((actor) => actor.actorIds.includes(actorId));
  const tankedPlayer = input.tankedSnapshot?.actors.find((actor) => actor.actorIds.includes(actorId));
  const healPlayer = input.healSnapshot?.actors.find((actor) => actor.actorIds.includes(actorId));
  const identity = dpsPlayer ?? tankedPlayer ?? healPlayer;
  const durationMs = input.snapshot?.durationMs ?? input.tankedSnapshot?.durationMs ?? input.healSnapshot?.durationMs;
  if (!identity || durationMs === undefined) return undefined;
  return {
    fileName: input.fileName,
    encounterLabel: "Live encounter",
    encounterDurationMs: durationMs,
    statType: input.statType,
    selectedEnemyIds: [],
    player: dpsPlayer ?? emptyDpsRow(identity, durationMs),
    tankedPlayer,
    healPlayer,
    enemies: [],
    tankedEnemies: [],
    skillsByEnemy: {},
  };
}

export function emptyDpsRow(identity: MeterActorRow, durationMs: number): MeterActorRow {
  return {
    rowId: identity.rowId,
    actorIds: identity.actorIds,
    displayName: identity.displayName,
    ...(identity.archetype === undefined ? {} : { archetype: identity.archetype }),
    durationMs,
    damage: 0,
    dps: 0,
    currentDps: 0,
    contribution: 0,
    hits: 0,
    criticalHits: 0,
    kills: 0,
    mobsHit: 0,
    skills: [],
    timeline: [],
  };
}
