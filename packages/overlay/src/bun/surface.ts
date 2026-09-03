import { DisposableStore, onceWindowEvent } from "@svoverlay/desktop-platform/window-lifecycle";
import { registerLocaleWindow } from "@svoverlay/desktop-platform/locale-window";
import { translate } from "@svoverlay/i18n/backend";
import { BrowserView, BrowserWindow } from "@svoverlay/desktop-runtime";

import type { OverlayRpc } from "../app-types.ts";
import { displayKey, type OverlayDisplay } from "../display-layout.ts";
import type { OverlayController, OverlaySurfaceSink } from "./controller.ts";

export interface OverlaySurfaceOptions {
  controller: OverlayController;
  display: OverlayDisplay;
  onClosed?: (display: string) => void;
}

export interface OverlaySurface {
  readonly display: string;
  close(): void;
}

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
        resetShortcutsToDefaults: () => {
          controller.resetShortcutsToDefaults();
          return controller.controlState(key);
        },
        setRequiredStatuses: ({ category, statusIds }) => {
          controller.setRequiredStatuses(category, statusIds);
          return controller.controlState(key);
        },
        resetXpTracker: () => controller.resetXpTracker(),
        resetGoldTracker: () => controller.resetGoldTracker(),
        setMinimapEnabled: ({ enabled }) => {
          controller.setMinimapEnabled(enabled);
          return controller.controlState(key);
        },
        setMinimapRarityFilter: ({ rarity }) => controller.setMinimapRarityFilter(rarity),
        setMinimapLootChanceFilter: ({ chance }) => controller.setMinimapLootChanceFilter(chance),
      },
      messages: {
        dragPreview: (preview) => controller.relayDragPreview(preview),
        dragPreviewEnded: () => controller.relayDragPreview(undefined),
      },
    },
  });

  const window = new BrowserWindow({
    title: translate("app.name"),
    url: "views://overlayview/index.html",
    frame: display.bounds,
    titleBarStyle: "hidden",
    transparent: true,
    resizable: false,
    hidden: true,
    rpc,
  });
  window.setAlwaysOnTop(true);
  window.hideFromTaskbar();
  window.setClickThrough(controller.locked);
  lifecycle.add(registerLocaleWindow(window));
  if (controller.overlayVisible) window.showInactive();
  lifecycle.add(onceWindowEvent(window, "close", () => {
    closed = true;
    controller.unregisterSurface(key);
    lifecycle.dispose();
    onClosed?.(key);
  }));

  const sink: OverlaySurfaceSink = {
    display: key,
    setClickThrough: (locked) => { if (!closed) window.setClickThrough(locked); },
    setVisible: (visible) => {
      if (closed) return;
      if (visible) window.showInactive();
      else window.hide();
    },
    sendControl: (state) => rpc.send.controlChanged(state),
    sendCharacter: (state) => rpc.send.characterChanged(state),
    sendStatuses: (state) => rpc.send.statusesChanged(state),
    sendMeter: (state) => rpc.send.meterChanged(state),
    sendBossTimers: (state) => rpc.send.bossTimersChanged(state),
    sendDragPreview: (preview) => rpc.send.dragPreviewChanged(preview),
    sendMinimap: (state) => rpc.send.minimapChanged(state),
    sendLootToast: (event) => rpc.send.lootDropped(event),
  };
  controller.registerSurface(sink);

  return {
    display: key,
    close: () => {
      if (closed) return;
      closed = true;
      controller.unregisterSurface(key);
      lifecycle.dispose();
      window.close();
    },
  };
}
