import { batch } from "@preact/signals";
import { DesktopView } from "@svoverlay/desktop-runtime/view";
import { disableWebChrome } from "@svoverlay/ui-kit/disable-web-chrome";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";

import type {
  OverlayControlState,
  OverlayDragPreview,
  OverlayElementId,
  OverlayRpc,
} from "../app-types.ts";
import { displayForRect } from "../display-layout.ts";
import {
  applyBossTimers,
  applyControl,
  applyStatuses,
  characterState,
  chromeState,
  dragPreview,
  meterState,
  minimapState,
  pushLootToast,
} from "./store.ts";
import type { ElementRect } from "./geometry.ts";

let pendingDragPreview: OverlayDragPreview | undefined;
let dragPreviewFrame = 0;

const rpc = DesktopView.defineRPC<OverlayRpc>({
  handlers: { requests: {}, messages: {
    controlChanged: (next) => { applyControl(repairRendererPayload(next)); },
    characterChanged: (next) => { characterState.value = repairRendererPayload(next); },
    statusesChanged: (next) => { applyStatuses(repairRendererPayload(next)); },
    meterChanged: (next) => { meterState.value = repairRendererPayload(next); },
    bossTimersChanged: (next) => { applyBossTimers(repairRendererPayload(next)); },
    dragPreviewChanged: (next) => { dragPreview.value = next; },
    minimapChanged: (next) => { minimapState.value = repairRendererPayload(next); },
    lootDropped: (next) => { pushLootToast(repairRendererPayload(next)); },
  } },
});

export const desktopView = new DesktopView({ rpc });

export function startOverlayTransport(): void {
  disableWebChrome();
  void desktopView.rpc?.request.getState({}).then((next) => {
    const repaired = repairRendererPayload(next);
    batch(() => {
      applyControl(repaired.control);
      characterState.value = repaired.character;
      applyStatuses(repaired.statuses);
      meterState.value = repaired.meter;
      minimapState.value = repaired.minimap;
      applyBossTimers(repaired.bossTimers);
    });
  });
}

export function sendDragPreview(preview: OverlayDragPreview): void {
  pendingDragPreview = preview;
  if (dragPreviewFrame) return;
  dragPreviewFrame = requestAnimationFrame(() => {
    dragPreviewFrame = 0;
    if (pendingDragPreview) desktopView.rpc?.send.dragPreview(pendingDragPreview);
    pendingDragPreview = undefined;
  });
}

export function endDragPreview(): void {
  if (dragPreviewFrame) cancelAnimationFrame(dragPreviewFrame);
  dragPreviewFrame = 0;
  pendingDragPreview = undefined;
  desktopView.rpc?.send.dragPreviewEnded({});
}

export function relayDrag(id: OverlayElementId, rect: ElementRect): void {
  const chrome = chromeState.value;
  if (!chrome?.surface || chrome.displayLayout.length < 2) return;
  const origin = chrome.surface.bounds;
  sendDragPreview({
    id,
    origin: chrome.surface.display,
    rect: { x: origin.x + rect.x, y: origin.y + rect.y, width: rect.width, height: rect.height },
  });
}

export function dropRequest(id: OverlayElementId, rect: ElementRect): Promise<OverlayControlState> | undefined {
  const requests = desktopView.rpc?.request;
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

export function setLocked(locked: boolean): Promise<void> {
  return desktopView.rpc?.request.setLocked({ locked }).then(applyControl) ?? Promise.resolve();
}

export function setElementEnabled(id: OverlayElementId, enabled: boolean): Promise<void> {
  return desktopView.rpc?.request.setElementEnabled({ id, enabled }).then(applyControl) ?? Promise.resolve();
}
