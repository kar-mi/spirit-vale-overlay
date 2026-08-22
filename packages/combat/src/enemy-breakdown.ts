
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
  bySkill: Map<string, Map<number, Map<string, EnemySkillStats>>>;
}
