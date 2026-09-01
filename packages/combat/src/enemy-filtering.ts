import type { CombatAnalysisState, MeterActorRow } from "./app-types.ts";

export interface FilteredActorRow {
  actor: MeterActorRow;
  damage: number;
  dps: number;
  hits: number;
  criticalHits: number;
  critRate?: number;
  contribution: number;
}

/** Whether the enemy filter has per-attacker data for this stat type. */
export function enemyFilterSupported(statType: CombatAnalysisState["statType"]): boolean {
  return statType === "damage" || statType === "tanked";
}

export function applyEnemyFilter(
  next: CombatAnalysisState,
  rows: MeterActorRow[],
  selectedEnemyIds: ReadonlySet<number>,
): FilteredActorRow[] {
  if (!enemyFilterSupported(next.statType) || selectedEnemyIds.size === 0) {
    return rows.map((actor) => ({
      actor,
      damage: actor.damage,
      dps: actor.dps,
      hits: actor.hits,
      criticalHits: actor.criticalHits,
      critRate: actor.critRate,
      contribution: actor.contribution,
    }));
  }
  const tanked = next.statType === "tanked";
  const breakdown = tanked ? next.tankedActorEnemyBreakdown : next.actorEnemyBreakdown;
  const snapshot = tanked ? next.tankedSnapshot : next.snapshot;
  const durationSeconds = Math.max(1, snapshot?.durationMs ?? 0) / 1000;
  const partial = rows.map((actor) => {
    const filtered = (breakdown[actor.rowId] ?? [])
      .filter((row) => selectedEnemyIds.has(row.targetId));
    const damage = filtered.reduce((sum, row) => sum + row.damage, 0);
    const hits = filtered.reduce((sum, row) => sum + row.hits, 0);
    const criticalHits = filtered.reduce((sum, row) => sum + row.criticalHits, 0);
    return {
      actor,
      damage,
      hits,
      criticalHits,
      dps: damage / durationSeconds,
      critRate: hits > 0 ? criticalHits / hits : undefined,
    };
  });
  const totalDamage = partial.reduce((sum, row) => sum + row.damage, 0);
  return partial
    .filter((row) => row.damage > 0)
    .map((row) => ({ ...row, contribution: totalDamage > 0 ? row.damage / totalDamage : 0 }));
}
