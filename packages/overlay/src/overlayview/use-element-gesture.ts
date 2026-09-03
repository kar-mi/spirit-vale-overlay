import { useState } from "preact/hooks";

import type { OverlayElementId, OverlayElementSettings } from "../app-types.ts";
import { chromeState, gridEnabled, selectedElementId } from "./store.ts";
import { dragRect, resizeRect, type ElementRect, type ResizeEdge } from "./geometry.ts";
import { applyControl } from "./store.ts";
import { desktopView, dropRequest, endDragPreview, relayDrag } from "./transport.ts";

const CLICK_MOVE_THRESHOLD_PX = 4;

type PointerGesture =
  | { kind: "drag"; pointerId: number; originX: number; originY: number; start: ElementRect }
  | { kind: "resize"; pointerId: number; originX: number; originY: number; start: ElementRect; edge: ResizeEdge };

export function useElementGesture(id: OverlayElementId, settings: OverlayElementSettings | undefined) {
  const [gesture, setGesture] = useState<PointerGesture>();
  const [preview, setPreview] = useState<ElementRect>();
  const geometryOptions = () => ({
    spansDisplays: (chromeState.value?.displayLayout.length ?? 1) > 1,
    snap: gridEnabled.value,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  });
  const rectFor = (active: PointerGesture, dx: number, dy: number): ElementRect => active.kind === "drag"
    ? dragRect(active.start, dx, dy, geometryOptions())
    : resizeRect(active.start, active.edge, dx, dy, id, geometryOptions());

  const move = (event: PointerEvent): void => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const next = rectFor(gesture, event.clientX - gesture.originX, event.clientY - gesture.originY);
    setPreview(next);
    if (gesture.kind === "drag") relayDrag(id, next);
  };
  const finish = (event: PointerEvent): void => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.originX;
    const dy = event.clientY - gesture.originY;
    if (gesture.kind === "drag" && Math.hypot(dx, dy) < CLICK_MOVE_THRESHOLD_PX) {
      setGesture(undefined);
      setPreview(undefined);
      endDragPreview();
      selectedElementId.value = id;
      return;
    }
    const finalRect = rectFor(gesture, dx, dy);
    const wasResize = gesture.kind === "resize";
    setGesture(undefined);
    setPreview(finalRect);
    if (!wasResize) selectedElementId.value = id;
    const request = wasResize
      ? desktopView.rpc?.request.setElementBounds({ id, ...finalRect })
      : dropRequest(id, finalRect);
    if (!request) {
      if (!wasResize) endDragPreview();
      setPreview(undefined);
      return;
    }
    void request.then(
      (next) => {
        applyControl(next);
        if (!wasResize) endDragPreview();
        setPreview(undefined);
      },
      () => {
        if (!wasResize) endDragPreview();
        setPreview(undefined);
      },
    );
  };
  const start = settings
    ? { x: settings.x, y: settings.y, width: settings.width, height: settings.height }
    : { x: 0, y: 0, width: 0, height: 0 };
  return {
    gesture,
    preview,
    move,
    finish,
    cancel: () => {
      endDragPreview();
      setGesture(undefined);
      setPreview(undefined);
    },
    beginDrag: (event: PointerEvent) => {
      setPreview(start);
      setGesture({ kind: "drag", pointerId: event.pointerId, originX: event.clientX, originY: event.clientY, start });
    },
    beginResize: (event: PointerEvent, edge: ResizeEdge) => {
      setPreview(start);
      setGesture({ kind: "resize", pointerId: event.pointerId, originX: event.clientX, originY: event.clientY, start, edge });
    },
  };
}
