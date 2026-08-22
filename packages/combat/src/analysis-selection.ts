export function validSelectedEnemyIds(
  selectedEnemyIds: readonly number[],
  availableEnemyIds: ReadonlySet<number>,
): number[] {
  return [...new Set(selectedEnemyIds)].filter((targetId) => availableEnemyIds.has(targetId));
}
