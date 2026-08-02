import { CombatHistoryStore } from "@kar-mi/spirit-vale-tools-combat";
import type {
  CombatDeathRecord,
  CombatEnemyBreakdown,
  FishNetDpsEncounterSnapshot,
} from "@kar-mi/spirit-vale-tools-combat";
import type { ReadModel } from "@kar-mi/spirit-vale-tools-sqlite";

import type { DeathLogEntry, DeathLogHit } from "./death-log.ts";
import type { EnemyBreakdownEncounter, EnemySkillStats } from "./enemy-breakdown.ts";

/** The desktop process's shared SQLite read model, when it is available. */
export interface CombatReadModelSource {
  model(): ReadModel | undefined;
  indexSession(sessionId: string, stream: "combat" | "rewards", options?: { finalize?: boolean }): Promise<boolean>;
}

/** One encounter's three meters plus its enemy breakdown, as the analysis views consume them. */
export interface IndexedEncounter {
  snapshot: FishNetDpsEncounterSnapshot;
  /** Absent on the replay fallback, which has no tanked or healing aggregation. */
  tankedSnapshot?: FishNetDpsEncounterSnapshot;
  healSnapshot?: FishNetDpsEncounterSnapshot;
  breakdown: EnemyBreakdownEncounter;
}

export interface IndexedEncounterSummary {
  encounterId: string;
  durationMs: number;
}

/**
 * Indexes a combat log and lists its encounters, without loading any of them.
 *
 * Resolves to undefined when there is no read model or the pass failed, leaving the caller to fall
 * back to replaying the file.
 */
export async function indexCombatSession(
  source: CombatReadModelSource | undefined,
  sessionId: string,
  limit: number,
): Promise<{ store: CombatHistoryStore; encounters: IndexedEncounterSummary[] } | undefined> {
  if (!source) return undefined;
  if (!await source.indexSession(sessionId, "combat", { finalize: true })) return undefined;
  const model = source.model();
  if (!model) return undefined;
  const store = new CombatHistoryStore(model);
  const encounters: IndexedEncounterSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = store.listEncounters({ sessionId, limit, ...(cursor ? { cursor } : {}) });
    for (const item of page.items) {
      if (encounters.length >= limit) break;
      encounters.push({ encounterId: item.encounterId, durationMs: item.durationMs });
    }
    cursor = encounters.length >= limit ? undefined : page.nextCursor;
  } while (cursor);
  return { store, encounters };
}

/** Loads one encounter's meters and enemy breakdown. Nothing else stays resident. */
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
  };
}

/** Reshapes the store's flat skill rows into the nested map the analysis views index by. */
export function toEnemyBreakdown(breakdown: CombatEnemyBreakdown): EnemyBreakdownEncounter {
  const bySkill = new Map<number, Map<number, Map<string, EnemySkillStats>>>();
  for (const row of breakdown.skills) {
    const byTarget = bySkill.get(row.attackerActorId) ?? new Map<number, Map<string, EnemySkillStats>>();
    bySkill.set(row.attackerActorId, byTarget);
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

/**
 * Reshapes stored death records into the view's entries.
 *
 * The store returns deaths newest-first, which is the order the log lists them in, and gives each a
 * stable `(encounterId, deathIndex)` key that the view's string ids are derived from.
 */
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
