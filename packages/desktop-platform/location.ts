export type SpiritValeLocation =
  | { kind: "map"; mapId: number }
  /** `floor` is absent when the tower is confirmed but no floor has been announced yet. */
  | { kind: "eternalTower"; floor?: number };

export function sameSpiritValeLocation(
  left: SpiritValeLocation | undefined,
  right: SpiritValeLocation | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.kind !== right.kind) return false;
  return left.kind === "map"
    ? left.mapId === (right as { kind: "map"; mapId: number }).mapId
    : left.floor === (right as { kind: "eternalTower"; floor?: number }).floor;
}

export function isSpiritValeLocation(value: unknown): value is SpiritValeLocation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate["kind"] === "map") return isNonNegativeInteger(candidate["mapId"]);
  return candidate["kind"] === "eternalTower"
    && (candidate["floor"] === undefined || isNonNegativeInteger(candidate["floor"]));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
