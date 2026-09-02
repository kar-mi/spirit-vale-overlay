import { minimumSizeFor, type OverlayElementId } from "../app-types.ts";

export const RESIZE_EDGES = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type ResizeEdge = (typeof RESIZE_EDGES)[number];
export interface ElementRect { x: number; y: number; width: number; height: number }

const GRID_SIZE = 10;

export function dragRect(
  start: ElementRect,
  dx: number,
  dy: number,
  options: { spansDisplays: boolean; snap: boolean; viewportWidth: number; viewportHeight: number },
): ElementRect {
  const x = options.spansDisplays
    ? Math.round(start.x + dx)
    : clamp(start.x + dx, 0, Math.max(0, options.viewportWidth - start.width));
  const y = options.spansDisplays
    ? Math.round(start.y + dy)
    : clamp(start.y + dy, 0, Math.max(0, options.viewportHeight - start.height));
  return { ...start, x: options.snap ? snapToGrid(x) : x, y: options.snap ? snapToGrid(y) : y };
}

export function resizeRect(
  start: ElementRect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  id: OverlayElementId,
  options: { snap: boolean; viewportWidth: number; viewportHeight: number },
): ElementRect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  const minimum = minimumSizeFor(id);
  if (edge.includes("w")) left = clamp(start.x + dx, 0, right - minimum.width);
  if (edge.includes("e")) right = clamp(start.x + start.width + dx, left + minimum.width, options.viewportWidth);
  if (edge.includes("n")) top = clamp(start.y + dy, 0, bottom - minimum.height);
  if (edge.includes("s")) bottom = clamp(start.y + start.height + dy, top + minimum.height, options.viewportHeight);
  if (options.snap) {
    left = snapToGrid(left);
    top = snapToGrid(top);
    right = snapToGrid(right);
    bottom = snapToGrid(bottom);
    if (right - left < minimum.width) right = left + minimum.width;
    if (bottom - top < minimum.height) bottom = top + minimum.height;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}
