import { CombatHistoryStore } from "@kar-mi/spirit-vale-tools-combat";
import type {
  CombatDeathRecord,
  CombatEnemyBreakdown,
} from "@kar-mi/spirit-vale-tools-combat";
import type { ReadModel } from "@kar-mi/spirit-vale-tools-sqlite";
import type { MeterEncounterSnapshot } from "@svoverlay/contracts/meter";

import type { DeathLogEntry, DeathLogHit } from "./death-log.ts";
import type { EnemyBreakdownEncounter, EnemySkillStats } from "./enemy-breakdown.ts";

export interface CombatReadModelSource {
  model(): ReadModel | undefined;
  acquire?(): () => void;
  indexSession(
    sessionId: string,
    stream: "combat" | "rewards",
    options?: { finalize?: boolean },
  ): Promise<{ ok: boolean }>;
}

export interface IndexedEncounter {
  snapshot: MeterEncounterSnapshot;
  tankedSnapshot?: MeterEncounterSnapshot;
  healSnapshot?: MeterEncounterSnapshot;
  breakdown: EnemyBreakdownEncounter;
  /** Per-attacker breakdown of damage taken, for the TPS enemy filter. */
  tankedBreakdown: EnemyBreakdownEncounter;
}

export interface IndexedEncounterSummary {
  encounterId: string;
  durationMs: number;
}

export interface IndexedSession {
  store: CombatHistoryStore;
  encounters: IndexedEncounterSummary[];
  omitted: number;
  invalidLines: number;
}

export async function indexCombatSession(
  source: CombatReadModelSource | undefined,
  sessionId: string,
  limit: number,
): Promise<IndexedSession | undefined> {
  if (!source) return undefined;
  const indexed = await source.indexSession(sessionId, "combat", { finalize: true });
  if (!indexed.ok) return undefined;
  const model = source.model();
  if (!model) return undefined;
  const store = new CombatHistoryStore(model);

  const all: IndexedEncounterSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = store.listEncounters({ sessionId, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
    for (const item of page.items) all.push({ encounterId: item.encounterId, durationMs: item.durationMs });
    cursor = page.nextCursor;
  } while (cursor);

  const encounters = all.length > limit ? all.slice(all.length - limit) : all;
  return {
    store,
    encounters,
    omitted: all.length - encounters.length,
    invalidLines: store.invalidLines(sessionId),
  };
}

const PAGE_SIZE = 500;

export function loadIndexedEncounter(
  store: CombatHistoryStore,
  sessionId: string,
  encounterId: string,
): IndexedEncounter | undefined {
  const snapshot = store.getEncounter(sessionId, encounterId);
  if (!snapshot) return undefined;
  return {
    snapshot,
    tankedSnapshot: store.getEncounter(sessionId, encounterId, { meter: "tanked" }),
    healSnapshot: store.getEncounter(sessionId, encounterId, { meter: "healing" }),
    breakdown: toEnemyBreakdown(store.getEnemyBreakdown(sessionId, encounterId)),
    tankedBreakdown: toEnemyBreakdown(store.getEnemyBreakdown(sessionId, encounterId, "tanked")),
  };
}

export function toEnemyBreakdown(breakdown: CombatEnemyBreakdown): EnemyBreakdownEncounter {
  const bySkill = new Map<string, Map<number, Map<string, EnemySkillStats>>>();
  for (const row of breakdown.skills) {
    const byTarget = bySkill.get(row.attackerRowId) ?? new Map<number, Map<string, EnemySkillStats>>();
    bySkill.set(row.attackerRowId, byTarget);
    const skills = byTarget.get(row.targetId) ?? new Map<string, EnemySkillStats>();
    byTarget.set(row.targetId, skills);
    skills.set(row.sourceId, {
      sourceLabel: row.sourceLabel,
      damage: row.damage,
      hits: row.hits,
      criticalHits: row.criticalHits,
    });
  }
  return { encounterId: breakdown.encounterId, enemies: breakdown.enemies.map((enemy) => ({ ...enemy })), bySkill };
}

export function toDeathLogEntries(records: readonly CombatDeathRecord[]): DeathLogEntry[] {
  return records.map((record) => {
    const key = `${record.encounterId}-${record.deathIndex}`;
    return {
      id: `death-${key}`,
      victimName: record.victimName,
      targetId: record.targetId,
      diedAtMs: record.diedAtMs,
      totalDamage: record.totalDamage,
      hits: record.hits.map((hit, index): DeathLogHit => ({
        id: `${key}-${index}`,
        beforeDeathMs: hit.beforeDeathMs,
        attackerActorId: hit.attackerActorId,
        sourceLabel: hit.sourceLabel,
        attackerLabel: hit.attackerLabel,
        attackerIsMonster: hit.attackerIsMonster,
        damage: hit.damage,
        critical: hit.critical,
      })),
    };
  });
}
