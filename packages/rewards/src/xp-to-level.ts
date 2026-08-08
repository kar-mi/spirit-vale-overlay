export function xpToLevelUp(
  level: number,
  experience: number,
  requirements: readonly number[],
): number | undefined {
  if (!Number.isInteger(level) || level < 1 || !Number.isFinite(experience) || experience < 0) return undefined;
  const requirement = requirements[level - 1];
  if (requirement === undefined) return undefined;
  return Math.max(0, requirement - experience);
}
