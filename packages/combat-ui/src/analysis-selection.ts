/** Keep inherited enemy selections that are available in the selected player's detail data. */
export function validSelectedEnemyIds(
  selectedEnemyIds: readonly number[],
  availableEnemyIds: ReadonlySet<number>,
): number[] {
  return [...new Set(selectedEnemyIds)].filter((targetId) => availableEnemyIds.has(targetId));
}
