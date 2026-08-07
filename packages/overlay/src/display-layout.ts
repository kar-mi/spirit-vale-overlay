import type { OverlayElementId, OverlayElementSettings } from "./app-types.ts";

export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The subset of electrobun's `Display` the overlay needs; keeps this module free of the runtime. */
export interface OverlayDisplay {
  bounds: DisplayBounds;
  isPrimary?: boolean;
}

/**
 * Stable-enough identity for a monitor.
 *
 * Deliberately derived from bounds rather than `Display.id`: that id comes straight from the
 * native `getAllDisplays` and is not guaranteed to survive a replug or reboot. A bounds key
 * changes when monitors are rearranged, which is the failure we want — a stale assignment falls
 * back to the home display rather than silently stranding a tile.
 */
export function displayKey(display: OverlayDisplay): string {
  const { x, y, width, height } = display.bounds;
  return `${Math.round(width)}x${Math.round(height)}@${Math.round(x)},${Math.round(y)}`;
}

/** The display a `homeDisplay` setting points at, falling back to primary when unset or gone. */
export function resolveHomeDisplay(
  displays: readonly OverlayDisplay[],
  homeDisplay: string,
): OverlayDisplay | undefined {
  if (displays.length === 0) return undefined;
  const stored = displays.find((display) => displayKey(display) === homeDisplay);
  return stored ?? displays.find((display) => display.isPrimary) ?? displays[0];
}

/** The resolved home key, or `""` when there are no displays to resolve against. */
export function resolveHomeDisplayKey(displays: readonly OverlayDisplay[], homeDisplay: string): string {
  const resolved = resolveHomeDisplay(displays, homeDisplay);
  return resolved ? displayKey(resolved) : homeDisplay;
}

/**
 * The display an element is shown on: its own assignment when that monitor is still connected,
 * otherwise the home display. An unplugged monitor must never hide a tile.
 */
export function resolveElementDisplay(
  displays: readonly OverlayDisplay[],
  assigned: string,
  homeKey: string,
): OverlayDisplay | undefined {
  const stored = displays.find((display) => displayKey(display) === assigned);
  if (stored) return stored;
  return displays.find((display) => displayKey(display) === homeKey);
}

/** Same, as a key — what gets persisted back into settings after normalization. */
export function resolveElementDisplayKey(
  displays: readonly OverlayDisplay[],
  assigned: string,
  homeKey: string,
): string {
  const resolved = resolveElementDisplay(displays, assigned, homeKey);
  return resolved ? displayKey(resolved) : homeKey;
}

/**
 * Display keys that need a surface: exactly those with at least one enabled element.
 *
 * A display with nothing on it gets no overlay window at all, which is what lets a game on that
 * monitor keep DWM's independent-flip present mode.
 */
export function displaysNeedingSurface(
  elements: Record<OverlayElementId, OverlayElementSettings>,
): string[] {
  const keys = new Set<string>();
  for (const element of Object.values(elements)) {
    if (element.enabled) keys.add(element.display);
  }
  return [...keys];
}

/**
 * The elements assigned to one display, in the order they appear in `elements`.
 *
 * Partial on purpose: a surface is only told about its own tiles, so an unrelated tile cannot
 * render there even as an edit-mode ghost.
 */
export function elementsForDisplay(
  elements: Record<OverlayElementId, OverlayElementSettings>,
  key: string,
): Partial<Record<OverlayElementId, OverlayElementSettings>> {
  return Object.fromEntries(
    Object.entries(elements).filter(([, element]) => element.display === key),
  ) as Partial<Record<OverlayElementId, OverlayElementSettings>>;
}
