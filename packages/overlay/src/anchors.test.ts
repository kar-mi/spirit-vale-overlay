import { describe, expect, test } from "bun:test";

import {
  anchorOffset,
  descendantsOf,
  hasAnchorCycle,
  repositionElement,
  resolveAnchoredLayout,
  settleAnchors,
  type ElementsById,
} from "./anchors.ts";
import { OVERLAY_ELEMENT_IDS, type OverlayElementSettings } from "./app-types.ts";

function element(overrides: Partial<OverlayElementSettings> = {}): OverlayElementSettings {
  return { enabled: true, opacity: 1, x: 0, y: 0, width: 200, height: 100, display: "primary", ...overrides };
}

/** A full elements record with every id defaulted, so tests only spell out what they care about. */
function elementsWith(overrides: Partial<ElementsById>): ElementsById {
  return Object.fromEntries(OVERLAY_ELEMENT_IDS.map((id) => [id, overrides[id] ?? element()])) as ElementsById;
}

describe("hasAnchorCycle", () => {
  test("is false for an unanchored element", () => {
    const elements = elementsWith({});
    expect(hasAnchorCycle(elements, "mana")).toBe(false);
  });

  test("is false for a simple parent chain", () => {
    const elements = elementsWith({
      mana: element({ anchor: { parentId: "health", offsetX: 0, offsetY: 40, matchWidth: false, matchHeight: false } }),
    });
    expect(hasAnchorCycle(elements, "mana")).toBe(false);
  });

  test("detects a direct self-reference", () => {
    const elements = elementsWith({
      health: element({ anchor: { parentId: "health", offsetX: 0, offsetY: 0, matchWidth: false, matchHeight: false } }),
    });
    expect(hasAnchorCycle(elements, "health")).toBe(true);
  });

  test("detects a two-element cycle", () => {
    const elements = elementsWith({
      health: element({ anchor: { parentId: "mana", offsetX: 0, offsetY: 0, matchWidth: false, matchHeight: false } }),
      mana: element({ anchor: { parentId: "health", offsetX: 0, offsetY: 0, matchWidth: false, matchHeight: false } }),
    });
    expect(hasAnchorCycle(elements, "health")).toBe(true);
    expect(hasAnchorCycle(elements, "mana")).toBe(true);
  });
});

describe("descendantsOf", () => {
  test("finds direct and transitive children", () => {
    const elements = elementsWith({
      mana: element({ anchor: { parentId: "health", offsetX: 0, offsetY: 40, matchWidth: false, matchHeight: false } }),
      weight: element({ anchor: { parentId: "mana", offsetX: 0, offsetY: 30, matchWidth: false, matchHeight: false } }),
    });
    expect(new Set(descendantsOf(elements, "health"))).toEqual(new Set(["mana", "weight"]));
  });

  test("is empty for a leaf", () => {
    const elements = elementsWith({});
    expect(descendantsOf(elements, "health")).toEqual([]);
  });
});

describe("resolveAnchoredLayout", () => {
  test("moves the dragged element and cascades the same delta to its anchored children", () => {
    const elements = elementsWith({
      health: element({ x: 100, y: 200, width: 300, height: 50 }),
      mana: element({ x: 100, y: 260, width: 300, height: 50, anchor: { parentId: "health", offsetX: 0, offsetY: 60, matchWidth: false, matchHeight: false } }),
    });

    const result = resolveAnchoredLayout(elements, "health", { x: 150, y: 220, width: 300, height: 50 });

    expect(result.health).toMatchObject({ x: 150, y: 220 });
    // mana keeps its stored offset (0, +60) from health's new position.
    expect(result.mana).toMatchObject({ x: 150, y: 280 });
  });

  test("cascades transitively through a grandchild", () => {
    const elements = elementsWith({
      health: element({ x: 0, y: 0 }),
      mana: element({ x: 0, y: 60, anchor: { parentId: "health", offsetX: 0, offsetY: 60, matchWidth: false, matchHeight: false } }),
      weight: element({ x: 0, y: 120, anchor: { parentId: "mana", offsetX: 0, offsetY: 60, matchWidth: false, matchHeight: false } }),
    });

    const result = resolveAnchoredLayout(elements, "health", { x: 500, y: 500, width: 200, height: 100 });

    expect(result.mana).toMatchObject({ x: 500, y: 560 });
    expect(result.weight).toMatchObject({ x: 500, y: 620 });
  });

  test("does not move a sibling that isn't anchored to the dragged element", () => {
    const elements = elementsWith({
      health: element({ x: 0, y: 0 }),
      xpTracker: element({ x: 900, y: 900 }),
    });

    const result = resolveAnchoredLayout(elements, "health", { x: 400, y: 400, width: 200, height: 100 });

    expect(result.xpTracker).toMatchObject({ x: 900, y: 900 });
  });

  test("matchWidth/matchHeight children pick up the parent's new size", () => {
    const elements = elementsWith({
      health: element({ x: 0, y: 0, width: 300, height: 50 }),
      mana: element({
        x: 0, y: 60, width: 200, height: 20,
        anchor: { parentId: "health", offsetX: 0, offsetY: 60, matchWidth: true, matchHeight: false },
      }),
    });

    const result = resolveAnchoredLayout(elements, "health", { x: 0, y: 0, width: 450, height: 80 });

    expect(result.mana.width).toBe(450);
    // matchHeight is false, so mana's own height is left alone even though the parent's changed.
    expect(result.mana.height).toBe(20);
  });
});

describe("settleAnchors", () => {
  test("recomputes a child's x/y from a stale stored value using the authoritative offset", () => {
    const elements = elementsWith({
      health: element({ x: 100, y: 100 }),
      // mana's x/y is stale (doesn't match health.x+0, health.y+60) — as if health moved after last save.
      mana: element({ x: 999, y: 999, anchor: { parentId: "health", offsetX: 0, offsetY: 60, matchWidth: false, matchHeight: false } }),
    });

    const result = settleAnchors(elements);

    expect(result.mana).toMatchObject({ x: 100, y: 160 });
  });

  test("leaves an unanchored element's position untouched", () => {
    const elements = elementsWith({ health: element({ x: 42, y: 42 }) });
    expect(settleAnchors(elements).health).toMatchObject({ x: 42, y: 42 });
  });
});

describe("anchorOffset", () => {
  test("computes the offset from current positions", () => {
    const elements = elementsWith({
      health: element({ x: 100, y: 200 }),
      mana: element({ x: 100, y: 260 }),
    });
    expect(anchorOffset(elements, "mana", "health")).toEqual({ offsetX: 0, offsetY: 60 });
  });
});

describe("repositionElement", () => {
  test("moving an unanchored element is a plain cascade", () => {
    const elements = elementsWith({ health: element({ x: 0, y: 0 }) });
    const result = repositionElement(elements, "health", { x: 10, y: 20, width: 200, height: 100 });
    expect(result.health).toMatchObject({ x: 10, y: 20 });
  });

  test("dragging an anchored child directly re-pins its offset instead of snapping back", () => {
    const elements = elementsWith({
      health: element({ x: 100, y: 100 }),
      mana: element({ x: 100, y: 160, anchor: { parentId: "health", offsetX: 0, offsetY: 60, matchWidth: false, matchHeight: false } }),
    });

    // User drags mana off to the side, away from its old offset.
    const dragged = repositionElement(elements, "mana", { x: 400, y: 500, width: 200, height: 100 });
    expect(dragged.mana).toMatchObject({ x: 400, y: 500 });
    expect(dragged.mana.anchor).toMatchObject({ parentId: "health", offsetX: 300, offsetY: 400 });

    // Settling again (as normalizeOverlaySettings would on the next load) must not snap it back,
    // because the offset itself was re-pinned, not left stale.
    expect(settleAnchors(dragged).mana).toMatchObject({ x: 400, y: 500 });
  });

  test("re-pinned child still follows the parent on its next move", () => {
    const elements = elementsWith({
      health: element({ x: 100, y: 100 }),
      mana: element({ x: 100, y: 160, anchor: { parentId: "health", offsetX: 0, offsetY: 60, matchWidth: false, matchHeight: false } }),
    });
    const dragged = repositionElement(elements, "mana", { x: 400, y: 500, width: 200, height: 100 });

    const parentMoved = resolveAnchoredLayout(dragged, "health", { x: 150, y: 150, width: 200, height: 100 });

    expect(parentMoved.mana).toMatchObject({ x: 450, y: 550 });
  });
});
