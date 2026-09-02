import { useState } from "preact/hooks";
import { useTranslator } from "@svoverlay/i18n/browser";

import type { OverlayElementId } from "../app-types.ts";
import { applyControl, elementStates, panelPosition, selectedElementId } from "./store.ts";
import { desktopView, setElementEnabled } from "./transport.ts";

export function ElementInspectorPanel({ selectedId }: { selectedId: OverlayElementId | undefined }) {
  const t = useTranslator();
  const [headerDrag, setHeaderDrag] = useState<{
    pointerId: number;
    originX: number;
    originY: number;
    start: { x: number; y: number };
  }>();
  const settings = selectedId ? elementStates[selectedId].value : undefined;
  if (!selectedId || !settings) return null;
  const position = panelPosition.value ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  return (
    <div class="element-inspector-panel" style={{ left: `${position.x}px`, top: `${position.y}px` }} onPointerDown={(event) => event.stopPropagation()}>
      <div
        class={headerDrag ? "inspector-header dragging" : "inspector-header"}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setHeaderDrag({ pointerId: event.pointerId, originX: event.clientX, originY: event.clientY, start: position });
        }}
        onPointerMove={(event) => {
          if (!headerDrag || event.pointerId !== headerDrag.pointerId) return;
          panelPosition.value = {
            x: headerDrag.start.x + event.clientX - headerDrag.originX,
            y: headerDrag.start.y + event.clientY - headerDrag.originY,
          };
        }}
        onPointerUp={() => setHeaderDrag(undefined)}
        onPointerCancel={() => setHeaderDrag(undefined)}
      >
        <span>{t(`overlay.element.${selectedId}`)}</span>
        <button type="button" class="inspector-close" aria-label={t("overlay.inspector.close")} onPointerDown={(event) => event.stopPropagation()} onClick={() => { selectedElementId.value = undefined; }}>×</button>
      </div>
      <label class="inspector-row">
        <span>{t("overlay.inspector.opacity")}</span>
        <output>{Math.round(settings.opacity * 100)}%</output>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={settings.opacity}
          onInput={(event) => {
            void desktopView.rpc?.request.setElementOpacity({ id: selectedId, opacity: event.currentTarget.valueAsNumber })
              .then(applyControl);
          }}
        />
      </label>
      <label class="inspector-row inspector-toggle">
        <input type="checkbox" checked={settings.enabled} onChange={() => void setElementEnabled(selectedId, !settings.enabled)} />
        {t("overlay.inspector.visible")}
      </label>
    </div>
  );
}
