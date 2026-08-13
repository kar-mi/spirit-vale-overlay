import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import {
  OVERLAY_ELEMENT_LABELS,
  type OverlayControlState,
  type OverlayDisplayPlacement,
  type OverlayElementId,
} from "../app-types.ts";
import type { WeightWarnLevel } from "../weight-warning.ts";
import { displayForRect } from "../display-layout.ts";
import { dragRect, resizeRect, RESIZE_EDGES, type ElementRect, type ResizeEdge } from "./geometry.ts";
import {
  applyControl,
  chromeState,
  dragPreview,
  electroview,
  elementStates,
  endDragPreview,
  gridEnabled,
  sendDragPreview,
} from "./renderer-state.ts";

type PointerGesture =
  | { kind: "drag"; pointerId: number; originX: number; originY: number; start: ElementRect }
  | { kind: "resize"; pointerId: number; originX: number; originY: number; start: ElementRect; edge: ResizeEdge };

export interface OverlayElementProps {
  id: OverlayElementId;
  locked: boolean;
  warn?: boolean;
  weightWarn?: WeightWarnLevel;
  children: ComponentChildren;
}

export function DragGhost({ surface }: { surface?: OverlayDisplayPlacement }) {
  const preview = dragPreview.value;
  if (!preview || !surface || preview.origin === surface.display) return null;
  const x = preview.rect.x - surface.bounds.x;
  const y = preview.rect.y - surface.bounds.y;
  if (x + preview.rect.width < 0 || y + preview.rect.height < 0) return null;
  if (x > surface.bounds.width || y > surface.bounds.height) return null;
  return (
    <div class="drag-ghost" aria-hidden="true" style={{ left: `${x}px`, top: `${y}px`, width: `${preview.rect.width}px`, height: `${preview.rect.height}px` }}>
      <span>{OVERLAY_ELEMENT_LABELS[preview.id]}</span>
    </div>
  );
}

export function OverlayElement({ id, locked, warn, weightWarn, children }: OverlayElementProps) {
  const [gesture, setGesture] = useState<PointerGesture>();
  const [preview, setPreview] = useState<ElementRect>();
  const settings = elementStates[id].value;
  if (!settings || (locked && !settings.enabled)) return null;
  const rect = preview ?? settings;
  const className = [
    "overlay-element",
    !settings.enabled && "hidden-preview",
    warn && settings.enabled && "missing-statuses",
    weightWarn && settings.enabled && `weight-${weightWarn}`,
    gesture?.kind === "resize" ? "resizing" : gesture?.kind === "drag" ? "dragging" : undefined,
  ].filter(Boolean).join(" ");
  const move = (event: PointerEvent): void => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.originX;
    const dy = event.clientY - gesture.originY;
    const options = geometryOptions();
    const next = gesture.kind === "drag"
      ? dragRect(gesture.start, dx, dy, options)
      : resizeRect(gesture.start, gesture.edge, dx, dy, id, options);
    setPreview(next);
    if (gesture.kind === "drag") relayDrag(id, next);
  };
  const finish = (event: PointerEvent): void => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.originX;
    const dy = event.clientY - gesture.originY;
    const options = geometryOptions();
    const finalRect = gesture.kind === "drag"
      ? dragRect(gesture.start, dx, dy, options)
      : resizeRect(gesture.start, gesture.edge, dx, dy, id, options);
    const wasResize = gesture.kind === "resize";
    setGesture(undefined);
    setPreview(finalRect);
    const request = wasResize
      ? electroview.rpc?.request.setElementBounds({ id, ...finalRect })
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
  return (
    <section
      class={className}
      data-element-id={id}
      style={{ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` }}
      onPointerDown={(event) => {
        if (locked || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const start = { x: settings.x, y: settings.y, width: settings.width, height: settings.height };
        setPreview(start);
        setGesture({ kind: "drag", pointerId: event.pointerId, originX: event.clientX, originY: event.clientY, start });
      }}
      onContextMenu={(event) => {
        if (locked) return;
        event.preventDefault();
        event.stopPropagation();
        void setElementEnabled(id, !settings.enabled);
      }}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={() => {
        endDragPreview();
        setGesture(undefined);
        setPreview(undefined);
      }}
    >
      <div class="overlay-surface" style={`--element-background-alpha:${settings.opacity * 0.76}`}>{children}</div>
      {!locked && !settings.enabled && <span class="hidden-indicator">Hidden</span>}
      {!locked && <span class="element-title-badge">{OVERLAY_ELEMENT_LABELS[id]}</span>}
      {!locked && (
        <label class="element-opacity-control" onPointerDown={(event) => event.stopPropagation()}>
          <span>Tile opacity</span>
          <output>{Math.round(settings.opacity * 100)}%</output>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.opacity}
            onInput={(event) => {
              const request = electroview.rpc?.request.setElementOpacity({ id, opacity: event.currentTarget.valueAsNumber });
              void request?.then((next) => applyControl(next));
            }}
          />
        </label>
      )}
      {!locked && RESIZE_EDGES.map((edge) => (
        <span
          key={edge}
          class={`resize-handle resize-${edge}`}
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            const start = { x: settings.x, y: settings.y, width: settings.width, height: settings.height };
            setPreview(start);
            setGesture({ kind: "resize", pointerId: event.pointerId, originX: event.clientX, originY: event.clientY, start, edge });
          }}
        />
      ))}
    </section>
  );
}

function geometryOptions() {
  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    snap: gridEnabled.value,
    spansDisplays: (chromeState.value?.displayLayout.length ?? 1) > 1,
  };
}

function relayDrag(id: OverlayElementId, rect: ElementRect): void {
  const chrome = chromeState.value;
  if (!chrome?.surface || chrome.displayLayout.length < 2) return;
  const origin = chrome.surface.bounds;
  sendDragPreview({
    id,
    origin: chrome.surface.display,
    rect: { x: origin.x + rect.x, y: origin.y + rect.y, width: rect.width, height: rect.height },
  });
}

function dropRequest(id: OverlayElementId, rect: ElementRect): Promise<OverlayControlState> | undefined {
  const requests = electroview.rpc?.request;
  const chrome = chromeState.value;
  if (!requests) return undefined;
  if (!chrome?.surface || chrome.displayLayout.length < 2) {
    return requests.setElementPosition({ id, x: rect.x, y: rect.y });
  }
  const origin = chrome.surface.bounds;
  const dropped = { x: origin.x + rect.x, y: origin.y + rect.y, width: rect.width, height: rect.height };
  const target = displayForRect(chrome.displayLayout, dropped) ?? chrome.surface;
  if (target.display === chrome.surface.display) {
    return requests.setElementPosition({ id, x: rect.x, y: rect.y });
  }
  return requests.setElementPlacement({
    id,
    display: target.display,
    x: dropped.x - target.bounds.x,
    y: dropped.y - target.bounds.y,
  });
}

function setElementEnabled(id: OverlayElementId, enabled: boolean): Promise<void> {
  return electroview.rpc?.request.setElementEnabled({ id, enabled }).then((next) => applyControl(next)) ?? Promise.resolve();
}
