export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_SNAP_THRESHOLD_PX = 8;

/** The three alignment points on an axis: near edge, center, far edge. */
function axisPoints(start: number, size: number): readonly [number, number, number] {
  return [start, start + size / 2, start + size];
}

/**
 * Finds the closest (point, targetLine) pair within `threshold` and returns the position that
 * would put that point exactly on the line — or `undefined` if nothing is close enough. Ties
 * (equal distance) keep whichever candidate was seen first, i.e. the earlier target in the list.
 */
function snapAxis(points: readonly [number, number, number], targetLines: readonly number[], threshold: number): number | undefined {
  const pointsWithOffset: readonly [point: number, offsetFromStart: number][] = [
    [points[0], 0],
    [points[1], points[1] - points[0]],
    [points[2], points[2] - points[0]],
  ];
  let best: { delta: number; snappedStart: number } | undefined;
  for (const [point, offset] of pointsWithOffset) {
    for (const line of targetLines) {
      const delta = Math.abs(point - line);
      if (delta <= threshold && (!best || delta < best.delta)) {
        best = { delta, snappedStart: line - offset };
      }
    }
  }
  return best?.snappedStart;
}

/**
 * Snaps `rect`'s position (not its size) to the nearest edge or center of any `target`,
 * independently per axis — an axis with nothing within `threshold` is returned unchanged. Pure,
 * so the same call drives both the live drag preview and what actually gets persisted; they can't
 * disagree. Excludes nothing itself — callers are responsible for keeping the dragged element and
 * anything anchored to it (which moves with it in the live preview) out of `targets`, or every
 * drag would "snap" to its own shadow.
 */
export function snapPosition(rect: Rect, targets: readonly Rect[], threshold = DEFAULT_SNAP_THRESHOLD_PX): { x: number; y: number } {
  const xLines = targets.flatMap((target) => axisPoints(target.x, target.width));
  const yLines = targets.flatMap((target) => axisPoints(target.y, target.height));
  return {
    x: snapAxis(axisPoints(rect.x, rect.width), xLines, threshold) ?? rect.x,
    y: snapAxis(axisPoints(rect.y, rect.height), yLines, threshold) ?? rect.y,
  };
}
