/**
 * Shapes for the past-analysis enemy breakdown. The rows themselves come from the combat read model
 * via `combat-history.ts`; nothing here reads a log.
 */

export interface EnemyOption {
  targetId: number;
  label: string;
}

export interface EnemySkillStats {
  sourceLabel: string;
  damage: number;
  hits: number;
  criticalHits: number;
}

export interface EnemyDamageRow {
  targetId: number;
  damage: number;
  hits: number;
  criticalHits: number;
}

export interface EnemyBreakdownEncounter {
  encounterId: string;
  enemies: EnemyOption[];
  /** rendered attacker row -> target enemy -> source skill -> accumulated stats. */
  bySkill: Map<string, Map<number, Map<string, EnemySkillStats>>>;
}
