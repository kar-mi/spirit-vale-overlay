import type { OverlayElementId, OverlayElementSettings } from "./app-types.ts";

export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayDisplay {
  bounds: DisplayBounds;
  isPrimary?: boolean;
}

/**
 * Moves a rectangle just far enough to fit inside the supplied bounds.
 * The rectangle's size is preserved; callers that permit oversized rectangles
 * should normalize their dimensions before constraining their position.
 */
export function constrainRectToBounds<T extends DisplayBounds>(rect: T, bounds: DisplayBounds): T {
  const maximumX = bounds.x + Math.max(0, bounds.width - rect.width);
  const maximumY = bounds.y + Math.max(0, bounds.height - rect.height);
  return {
    ...rect,
    x: Math.max(bounds.x, Math.min(maximumX, rect.x)),
    y: Math.max(bounds.y, Math.min(maximumY, rect.y)),
  };
}

export function displayKey(display: OverlayDisplay): string {
  const { x, y, width, height } = display.bounds;
  return `${Math.round(width)}x${Math.round(height)}@${Math.round(x)},${Math.round(y)}`;
}

export function resolveHomeDisplay(
  displays: readonly OverlayDisplay[],
  homeDisplay: string,
): OverlayDisplay | undefined {
  if (displays.length === 0) return undefined;
  const stored = displays.find((display) => displayKey(display) === homeDisplay);
  return stored ?? displays.find((display) => display.isPrimary) ?? displays[0];
}

export function resolveHomeDisplayKey(displays: readonly OverlayDisplay[], homeDisplay: string): string {
  const resolved = resolveHomeDisplay(displays, homeDisplay);
  return resolved ? displayKey(resolved) : homeDisplay;
}

export function resolveElementDisplay(
  displays: readonly OverlayDisplay[],
  assigned: string,
  homeKey: string,
): OverlayDisplay | undefined {
  const stored = displays.find((display) => displayKey(display) === assigned);
  if (stored) return stored;
  return displays.find((display) => displayKey(display) === homeKey);
}

export function resolveElementDisplayKey(
  displays: readonly OverlayDisplay[],
  assigned: string,
  homeKey: string,
): string {
  const resolved = resolveElementDisplay(displays, assigned, homeKey);
  return resolved ? displayKey(resolved) : homeKey;
}

export function displaysNeedingSurface(
  elements: Record<OverlayElementId, OverlayElementSettings>,
): string[] {
  const keys = new Set<string>();
  for (const element of Object.values(elements)) {
    if (element.enabled) keys.add(element.display);
  }
  return [...keys];
}

export function displayForRect<T extends { bounds: DisplayBounds }>(
  displays: readonly T[],
  rect: DisplayBounds,
): T | undefined {
  let best: T | undefined;
  let bestOverlap = 0;
  for (const display of displays) {
    const overlap = overlapArea(display.bounds, rect);
    if (overlap <= bestOverlap) continue;
    bestOverlap = overlap;
    best = display;
  }
  if (best) return best;
  let nearest: T | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const display of displays) {
    const distance = centreDistance(display.bounds, rect);
    if (distance >= nearestDistance) continue;
    nearestDistance = distance;
    nearest = display;
  }
  return nearest;
}

function overlapArea(a: DisplayBounds, b: DisplayBounds): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function centreDistance(a: DisplayBounds, b: DisplayBounds): number {
  const dx = (a.x + a.width / 2) - (b.x + b.width / 2);
  const dy = (a.y + a.height / 2) - (b.y + b.height / 2);
  return dx * dx + dy * dy;
}

export function elementsForDisplay(
  elements: Record<OverlayElementId, OverlayElementSettings>,
  key: string,
): Partial<Record<OverlayElementId, OverlayElementSettings>> {
  return Object.fromEntries(
    Object.entries(elements).filter(([, element]) => element.display === key),
  ) as Partial<Record<OverlayElementId, OverlayElementSettings>>;
}
