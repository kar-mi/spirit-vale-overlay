import { describe, expect, test } from "bun:test";

import { visibleWindowFrame } from "./window-placement-frame.ts";

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const secondary = { x: -1280, y: 0, width: 1280, height: 1024 };

describe("window placement visibility", () => {
  test("keeps a visible frame on its current monitor", () => {
    expect(visibleWindowFrame(
      { x: -900, y: 100, width: 700, height: 600 },
      [primary, secondary],
      { width: 500, height: 400 },
    )).toEqual({ x: -900, y: 100, width: 700, height: 600 });
  });

  test("centers a disconnected-monitor frame on the primary display", () => {
    expect(visibleWindowFrame(
      { x: 4000, y: 200, width: 800, height: 600 },
      [primary],
      { width: 500, height: 400 },
    )).toEqual({ x: 560, y: 220, width: 800, height: 600 });
  });

  test("recovers a frame whose title bar is below the work area", () => {
    expect(visibleWindowFrame(
      { x: 400, y: 1020, width: 800, height: 600 },
      [primary],
      { width: 500, height: 400 },
    )).toEqual({ x: 560, y: 220, width: 800, height: 600 });
  });

  test("enforces minimums and limits oversized frames to the work area", () => {
    expect(visibleWindowFrame(
      { x: 10, y: 10, width: 200, height: 2000 },
      [primary],
      { width: 500, height: 400 },
    )).toEqual({ x: 10, y: 10, width: 500, height: 1040 });
  });
});
