import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { useTranslator } from "@svoverlay/i18n/browser";
import type { Translator } from "@svoverlay/i18n/translate";

import type { OverlayDisplayPlacement, OverlayElementId } from "../app-types.ts";
import { constrainRectToBounds } from "../display-layout.ts";
import type { WeightWarnLevel } from "../weight-warning.ts";
import { RESIZE_EDGES } from "./geometry.ts";
import { applyControl, dragPreview, elementStates, selectedElementId } from "./store.ts";
import { desktopView, setElementEnabled } from "./transport.ts";
import { useElementGesture } from "./use-element-gesture.ts";

const elementLabel = (t: Translator, id: OverlayElementId): string => t(`overlay.element.${id}`);

interface OverlayElementProps {
  id: OverlayElementId;
  locked: boolean;
  warn?: boolean;
  weightWarn?: WeightWarnLevel;
  bossAlert?: "window" | "expired";
  children: ComponentChildren;
}

export function OverlayElement({ id, locked, warn, weightWarn, bossAlert, children }: OverlayElementProps) {
  const t = useTranslator();
  const elementRef = useRef<HTMLElement>(null);
  const settings = elementStates[id].value;
  const gestureState = useElementGesture(id, settings);
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element || !settings || gestureState.gesture || gestureState.preview) return;
    const rendered = element.getBoundingClientRect();
    const constrained = constrainRectToBounds(
      { x: rendered.left, y: rendered.top, width: rendered.width, height: rendered.height },
      { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
    );
    const dx = constrained.x - rendered.left;
    const dy = constrained.y - rendered.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    void desktopView.rpc?.request.setElementPosition({
      id,
      x: Math.round(settings.x + dx),
      y: Math.round(settings.y + dy),
    }).then(applyControl);
  }, [id, locked, settings?.enabled, settings?.x, settings?.y, settings?.width, settings?.height, gestureState.gesture, gestureState.preview]);
  if (!settings) return null;
  if (locked && !settings.enabled) return null;
  const rect = gestureState.preview ?? settings;
  const displayRect = settings.enabled ? rect : { ...rect, width: 160, height: 36 };
  const selected = selectedElementId.value === id;
  const className = [
    "overlay-element",
    !settings.enabled && "hidden-preview",
    warn && settings.enabled && "missing-statuses",
    weightWarn && settings.enabled && `weight-${weightWarn}`,
    bossAlert && settings.enabled && `boss-alert-${bossAlert}`,
    !locked && selected && "selected",
    gestureState.gesture?.kind === "resize" ? "resizing" : gestureState.gesture?.kind === "drag" ? "dragging" : undefined,
  ].filter(Boolean).join(" ");
  return (
    <section
      ref={elementRef}
      class={className}
      data-element-id={id}
      style={{ left: `${displayRect.x}px`, top: `${displayRect.y}px`, width: `${displayRect.width}px`, height: `${displayRect.height}px` }}
      onPointerDown={(event) => {
        if (locked || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        gestureState.beginDrag(event);
      }}
      onContextMenu={(event) => {
        if (locked) return;
        event.preventDefault();
        event.stopPropagation();
        void setElementEnabled(id, !settings.enabled);
      }}
      onPointerMove={gestureState.move}
      onPointerUp={gestureState.finish}
      onPointerCancel={gestureState.cancel}
    >
      {settings.enabled ? (
        <>
          <div class="overlay-surface" style={`--element-background-alpha:${settings.opacity * 0.76}`}>{children}</div>
          {!locked && <span class="element-title-badge">{elementLabel(t, id)}</span>}
        </>
      ) : <div class="disabled-element-placeholder">{elementLabel(t, id)}</div>}
      {!locked && settings.enabled && selected && RESIZE_EDGES.map((edge) => (
        <span
          key={edge}
          class={`resize-handle resize-${edge}`}
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            gestureState.beginResize(event, edge);
          }}
        />
      ))}
    </section>
  );
}

export function DragGhost({ surface }: { surface?: OverlayDisplayPlacement }) {
  const t = useTranslator();
  const preview = dragPreview.value;
  if (!preview || !surface || preview.origin === surface.display) return null;
  const x = preview.rect.x - surface.bounds.x;
  const y = preview.rect.y - surface.bounds.y;
  if (x + preview.rect.width < 0 || y + preview.rect.height < 0) return null;
  if (x > surface.bounds.width || y > surface.bounds.height) return null;
  return (
    <div class="drag-ghost" aria-hidden="true" style={{ left: `${x}px`, top: `${y}px`, width: `${preview.rect.width}px`, height: `${preview.rect.height}px` }}>
      <span>{elementLabel(t, preview.id)}</span>
    </div>
  );
}
