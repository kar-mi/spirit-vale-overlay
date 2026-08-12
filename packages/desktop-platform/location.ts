export type SpiritValeLocation =
  | { kind: "map"; mapId: number }
  | { kind: "eternalTower"; floor: number };

export function sameSpiritValeLocation(
  left: SpiritValeLocation | undefined,
  right: SpiritValeLocation | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.kind !== right.kind) return false;
  return left.kind === "map"
    ? left.mapId === (right as { kind: "map"; mapId: number }).mapId
    : left.floor === (right as { kind: "eternalTower"; floor: number }).floor;
}

export function isSpiritValeLocation(value: unknown): value is SpiritValeLocation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate["kind"] === "map"
    ? isNonNegativeInteger(candidate["mapId"])
    : candidate["kind"] === "eternalTower" && isNonNegativeInteger(candidate["floor"]);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
