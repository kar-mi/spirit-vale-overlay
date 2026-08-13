import { describe, expect, test } from "bun:test";
import { dragRect, resizeRect, snapToGrid } from "./geometry.ts";

const viewport = { viewportWidth: 800, viewportHeight: 600, snap: false };

describe("overlay geometry", () => {
  test("clamps a single-display drag inside the viewport", () => {
    expect(dragRect({ x: 20, y: 20, width: 200, height: 100 }, -50, 700, viewport)).toEqual({ x: 0, y: 500, width: 200, height: 100 });
  });

  test("allows a multi-display drag to cross the local viewport", () => {
    expect(dragRect({ x: 20, y: 20, width: 200, height: 100 }, -50, 700, { ...viewport, spansDisplays: true })).toEqual({ x: -30, y: 720, width: 200, height: 100 });
  });

  test("enforces tile-specific minimum heights while resizing", () => {
    expect(resizeRect({ x: 0, y: 0, width: 200, height: 100 }, "s", 0, -99, "health", viewport).height).toBe(24);
    expect(resizeRect({ x: 0, y: 0, width: 200, height: 120 }, "s", 0, -99, "dpsChart", viewport).height).toBe(100);
  });

  test("snaps positions to the ten-pixel grid", () => {
    expect(snapToGrid(26)).toBe(30);
  });
});
