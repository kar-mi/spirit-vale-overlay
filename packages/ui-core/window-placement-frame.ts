import type { WindowFrame } from "./window-chrome.ts";

export interface WindowMinimumSize {
  width: number;
  height: number;
}

export interface DisplayWorkArea extends WindowFrame {}

export function visibleWindowFrame(
  frame: WindowFrame,
  workAreas: readonly DisplayWorkArea[],
  minimum: WindowMinimumSize,
): WindowFrame {
  const areas = workAreas.filter(isWindowFrame);
  if (areas.length === 0) {
    return {
      x: Math.round(frame.x),
      y: Math.round(frame.y),
      width: Math.max(minimum.width, Math.round(frame.width)),
      height: Math.max(minimum.height, Math.round(frame.height)),
    };
  }
  const primary = areas[0]!;
  const candidate = {
    x: Math.round(frame.x),
    y: Math.round(frame.y),
    width: Math.max(minimum.width, Math.round(frame.width)),
    height: Math.max(minimum.height, Math.round(frame.height)),
  };
  const visibleArea = areas.find((area) => {
    const overlap = intersection({ ...candidate, height: Math.min(32, candidate.height) }, area);
    return overlap.width >= 64 && overlap.height >= 32;
  });
  if (visibleArea) return fitSizeToArea(candidate, visibleArea, minimum);
  const width = Math.min(candidate.width, primary.width);
  const height = Math.min(candidate.height, primary.height);
  return {
    x: primary.x + Math.max(0, Math.round((primary.width - width) / 2)),
    y: primary.y + Math.max(0, Math.round((primary.height - height) / 2)),
    width,
    height,
  };
}

export function isWindowFrame(value: unknown): value is WindowFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as Record<string, unknown>;
  return ["x", "y", "width", "height"].every((key) => typeof frame[key] === "number"
    && Number.isFinite(frame[key]))
    && (frame.width as number) > 0
    && (frame.height as number) > 0;
}

function fitSizeToArea(
  frame: WindowFrame,
  area: DisplayWorkArea,
  minimum: WindowMinimumSize,
): WindowFrame {
  return {
    ...frame,
    width: Math.min(Math.max(minimum.width, frame.width), area.width),
    height: Math.min(Math.max(minimum.height, frame.height), area.height),
  };
}

function intersection(left: WindowFrame, right: WindowFrame): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)),
    height: Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)),
  };
}
