import { describe, expect, test } from "bun:test";

import { snapPosition, type Rect } from "./snap.ts";

const health: Rect = { x: 100, y: 100, width: 300, height: 50 };

describe("snapPosition", () => {
  test("snaps a top edge to a target's bottom edge within threshold", () => {
    // Dragged rect's top (y=152) is 2px below health's bottom (150) — well within an 8px threshold.
    const dragged: Rect = { x: 100, y: 152, width: 300, height: 50 };
    const result = snapPosition(dragged, [health], 8);
    expect(result.y).toBe(150);
  });

  test("leaves the axis unchanged when nothing is within threshold", () => {
    const dragged: Rect = { x: 100, y: 400, width: 300, height: 50 };
    const result = snapPosition(dragged, [health], 8);
    expect(result.y).toBe(400);
  });

  test("snaps left edges flush", () => {
    const dragged: Rect = { x: 104, y: 400, width: 300, height: 50 };
    const result = snapPosition(dragged, [health], 8);
    expect(result.x).toBe(100);
  });

  test("snaps to a shared center line", () => {
    // health's center x is 250. Dragged rect's own center is at x + width/2.
    const dragged: Rect = { x: 106, y: 400, width: 300, height: 20 }; // center = 256
    const result = snapPosition(dragged, [health], 8);
    expect(result.x).toBe(100); // shifted so its center lands on 250
  });

  test("snaps x and y independently against different targets", () => {
    const mana: Rect = { x: 500, y: 500, width: 200, height: 20 };
    // y=498 is unambiguously closest to mana's top edge (delta 2) — its center/bottom points are
    // farther from every one of mana's lines, so there's no closer competing pair to worry about.
    const dragged: Rect = { x: 103, y: 498, width: 300, height: 50 };
    const result = snapPosition(dragged, [health, mana], 8);
    expect(result.x).toBe(100); // from health's left edge
    expect(result.y).toBe(500); // from mana's top edge
  });

  test("picks the closest candidate when multiple are within threshold", () => {
    // Top edge is 3px from health.y=100; bottom edge is 1px from health's bottom=150.
    const dragged: Rect = { x: 100, y: 103, width: 300, height: 47 };
    const result = snapPosition(dragged, [health], 8);
    // Snapping the closer point (bottom, delta 1) means the rect's bottom lands exactly on 150.
    expect(result.y + 47).toBe(150);
  });

  test("empty target list leaves the rect untouched", () => {
    const dragged: Rect = { x: 42, y: 42, width: 300, height: 50 };
    expect(snapPosition(dragged, [])).toEqual({ x: 42, y: 42 });
  });
});
