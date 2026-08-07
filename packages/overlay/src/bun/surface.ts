import { hideWindowFromTaskbar, setWindowClickThrough } from "@spiritvale/ui-core/win32";
import { DisposableStore, onceWindowEvent } from "@spiritvale/ui-core/window-lifecycle";
import { BrowserView, BrowserWindow } from "electrobun/bun";

import type { OverlayRpc } from "../app-types.ts";
import { displayKey, type OverlayDisplay } from "../display-layout.ts";
import type { OverlayController, OverlaySurfaceSink } from "./controller.ts";

export interface OverlaySurfaceOptions {
  controller: OverlayController;
  display: OverlayDisplay;
  /** Fires when the user closes the window itself, as opposed to the controller retiring it. */
  onClosed?: (display: string) => void;
}

export interface OverlaySurface {
  readonly display: string;
  show(): void;
  hide(): void;
  close(): void;
}

/**
 * One transparent, click-through, always-on-top window pinned to one monitor.
 *
 * The window is sized to the display's own bounds, so the document's CSS origin is that display's
 * top-left and every stored tile coordinate stays display-relative — no virtual-desktop offsets.
 * It also means each surface gets its own WebView2 and therefore its own DPI scale factor, which
 * one window spanning several monitors could not do.
 */
export function createOverlaySurface({ controller, display, onClosed }: OverlaySurfaceOptions): OverlaySurface {
  const key = displayKey(display);
  const lifecycle = new DisposableStore();
  let closed = false;

  const rpc = BrowserView.defineRPC<OverlayRpc>({
    maxRequestTime: 30_000,
    handlers: {
      requests: {
        getState: () => controller.viewState(key),
        setLocked: ({ locked }) => {
          controller.updateLocked(locked);
          return controller.controlState(key);
        },
        setElementEnabled: ({ id, enabled }) => {
          controller.setElementEnabled(id, enabled);
          return controller.controlState(key);
        },
        setElementDisplay: ({ id, display: target }) => {
          controller.setElementDisplay(id, target);
          return controller.controlState(key);
        },
        setHomeDisplay: ({ display: target }) => {
          controller.setHomeDisplay(target);
          return controller.controlState(key);
        },
        setElementPosition: ({ id, x, y }) => {
          controller.setElementPosition(id, x, y);
          return controller.controlState(key);
        },
        setElementBounds: ({ id, x, y, width, height }) => {
          controller.setElementBounds(id, { x, y, width, height });
          return controller.controlState(key);
        },
        setElementPlacement: ({ id, display: target, x, y }) => {
          controller.setElementPlacement(id, target, x, y);
          return controller.controlState(key);
        },
        setElementOpacity: ({ id, opacity }) => {
          controller.setElementOpacity(id, opacity);
          return controller.controlState(key);
        },
        setOverlayVisible: ({ visible }) => {
          controller.setOverlayVisible(visible);
          return controller.controlState(key);
        },
        setShortcut: ({ action, shortcut }) => {
          controller.setShortcut(action, shortcut);
          return controller.controlState(key);
        },
        setRequiredStatuses: ({ category, statusIds }) => {
          controller.setRequiredStatuses(category, statusIds);
          return controller.controlState(key);
        },
        resetXpTracker: () => controller.resetXpTracker(),
        resetGoldTracker: () => controller.resetGoldTracker(),
      },
      messages: {
        dragPreview: (preview) => controller.relayDragPreview(preview),
        dragPreviewEnded: () => controller.relayDragPreview(undefined),
      },
    },
  });

  const window = new BrowserWindow({
    title: "Spirit Vale Overlay",
    url: "views://overlayview/index.html",
    frame: display.bounds,
    titleBarStyle: "hidden",
    transparent: true,
    hidden: true,
    rpc,
  });
  window.setAlwaysOnTop(true);
  hideWindowFromTaskbar(window.ptr);
  setWindowClickThrough(window.ptr, controller.locked);
  if (controller.overlayVisible) window.showInactive();
  lifecycle.add(onceWindowEvent(window, "close", () => {
    closed = true;
    controller.unregisterSurface(key);
    lifecycle.dispose();
    onClosed?.(key);
  }));

  const sink: OverlaySurfaceSink = {
    display: key,
    setClickThrough: (locked) => { if (!closed) setWindowClickThrough(window.ptr, locked); },
    setVisible: (visible) => {
      if (closed) return;
      if (visible) window.showInactive();
      else window.hide();
    },
    sendControl: (state) => rpc.send.controlChanged(state),
    sendCharacter: (state) => rpc.send.characterChanged(state),
    sendStatuses: (state) => rpc.send.statusesChanged(state),
    sendMeter: (state) => rpc.send.meterChanged(state),
    sendDragPreview: (preview) => rpc.send.dragPreviewChanged(preview),
  };
  controller.registerSurface(sink);

  return {
    display: key,
    show: () => sink.setVisible(true),
    hide: () => sink.setVisible(false),
    close: () => {
      if (closed) return;
      closed = true;
      controller.unregisterSurface(key);
      lifecycle.dispose();
      window.close();
    },
  };
}
