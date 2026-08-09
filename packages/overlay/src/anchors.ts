import { OVERLAY_ELEMENT_IDS, type OverlayElementId, type OverlayElementSettings } from "./app-types.ts";

export type ElementsById = Record<OverlayElementId, OverlayElementSettings>;

/**
 * Anchors form a forest (each element has at most one parent); a cycle would make positions
 * undefined and cascades infinite. Settings loaded from disk are untrusted, so this is the trust
 * boundary — call it before trusting any `anchor.parentId` chain.
 */
export function hasAnchorCycle(elements: ElementsById, id: OverlayElementId): boolean {
  const seen = new Set<OverlayElementId>();
  let current: OverlayElementId | undefined = id;
  while (current !== undefined) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = elements[current]?.anchor?.parentId;
  }
  return false;
}

/** All elements (direct and transitive) anchored to `parentId`, in no particular order. */
export function descendantsOf(elements: ElementsById, parentId: OverlayElementId): OverlayElementId[] {
  const children = OVERLAY_ELEMENT_IDS.filter((id) => elements[id]?.anchor?.parentId === parentId);
  return children.flatMap((id) => [id, ...descendantsOf(elements, id)]);
}

/**
 * Applies a move (and, for resizes, a size change) of `movedId` to `elements`, cascading the delta
 * to every element anchored to it — directly or transitively — so children track the same offset
 * they had before the move. Anchored children with `matchWidth`/`matchHeight` also pick up the
 * parent's new size. Pure and side-effect-free: safe to call on every pointermove for live preview,
 * and again on pointerup to compute what gets persisted, without the two ever disagreeing.
 *
 * Entries missing from `elements` (e.g. a tile that lives on a different monitor's surface, where
 * the caller only has a partial map) are skipped rather than throwing: every lookup here goes
 * through optional chaining, so a hole in the record just means that branch cascades no further.
 */
export function resolveAnchoredLayout(
  elements: ElementsById,
  movedId: OverlayElementId,
  moved: { x: number; y: number; width: number; height: number },
): ElementsById {
  const result: ElementsById = { ...elements, [movedId]: { ...elements[movedId]!, ...moved } };
  const applyChildren = (parentId: OverlayElementId): void => {
    const parent = result[parentId]!;
    for (const id of OVERLAY_ELEMENT_IDS) {
      const anchor = result[id]?.anchor;
      if (!anchor || anchor.parentId !== parentId) continue;
      const current = result[id]!;
      result[id] = {
        ...current,
        x: parent.x + anchor.offsetX,
        y: parent.y + anchor.offsetY,
        width: anchor.matchWidth ? parent.width : current.width,
        height: anchor.matchHeight ? parent.height : current.height,
      };
      applyChildren(id);
    }
  };
  applyChildren(movedId);
  return result;
}

/**
 * Re-derives every anchored element's x/y (and matched size) from its parent, starting from each
 * root (an element with no anchor). Call after loading/normalizing settings so a child's stored
 * x/y — which may be stale, e.g. saved mid-cascade — always agrees with its stored offset.
 * Assumes `elements` is already a forest (see `hasAnchorCycle`); does not itself guard against cycles.
 */
export function settleAnchors(elements: ElementsById): ElementsById {
  let result = elements;
  for (const id of OVERLAY_ELEMENT_IDS) {
    if (result[id]?.anchor) continue;
    const root = result[id]!;
    result = resolveAnchoredLayout(result, id, { x: root.x, y: root.y, width: root.width, height: root.height });
  }
  return result;
}

/** The offset to store when the user anchors `childId` to `parentId` at their current positions. */
export function anchorOffset(
  elements: ElementsById,
  childId: OverlayElementId,
  parentId: OverlayElementId,
): { offsetX: number; offsetY: number } {
  const child = elements[childId]!;
  const parent = elements[parentId]!;
  return { offsetX: child.x - parent.x, offsetY: child.y - parent.y };
}

/**
 * Applies a drag or resize of `id` to `elements` and cascades it to `id`'s own anchored
 * descendants. If `id` itself is anchored to a parent, dragging it directly re-pins its stored
 * offset to the dropped position rather than leaving the old offset — otherwise `settleAnchors`
 * would snap it straight back on the next normalize, since a stale offset always wins for an
 * anchored (non-root) element. The parent link and any match flags are preserved; only where it
 * sits relative to the parent changes. Locking (`move together`) and moving it solo without
 * detaching are meant to both just work — this is what makes that so.
 */
export function repositionElement(
  elements: ElementsById,
  id: OverlayElementId,
  next: { x: number; y: number; width: number; height: number },
): ElementsById {
  const element = elements[id]!;
  const moved: OverlayElementSettings = { ...element, ...next };
  const withMoved: ElementsById = { ...elements, [id]: moved };
  const repinned = element.anchor
    ? { ...moved, anchor: { ...element.anchor, ...anchorOffset(withMoved, id, element.anchor.parentId) } }
    : moved;
  return resolveAnchoredLayout({ ...elements, [id]: repinned }, id, next);
}
