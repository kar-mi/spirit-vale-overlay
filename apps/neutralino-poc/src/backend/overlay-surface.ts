import type { OverlayRpc } from "@svoverlay/overlay/app-types";
import type { OverlayController, OverlaySurfaceSink } from "../../../../packages/overlay/src/bun/controller.ts";
import { defineRpc } from "../shared/rpc.ts";
import type { Session } from "./rpc-server.ts";
import { configureOverlayWindow, setOverlayWindowVisible } from "./win32.ts";

export function attachOverlaySurface(
  session: Session,
  controller: OverlayController,
  processId: number | undefined,
  log?: (message: string) => void,
): OverlaySurfaceSink {
  const display = session.display!;
  const surfaceBounds = controller.controlState(display).surface?.bounds;
  let requestedVisible = controller.overlayVisible;
  let clickThroughReady = !controller.locked;
  let lastAppliedVisibility: boolean | undefined;
  const rpc = defineRpc<OverlayRpc, "bun">("bun", {
    maxRequestTime: 30_000,
    handlers: {
      requests: {
        getState: () => controller.viewState(display),
        setLocked: ({ locked }) => { controller.updateLocked(locked); return controller.controlState(display); },
        setElementEnabled: ({ id, enabled }) => { controller.setElementEnabled(id, enabled); return controller.controlState(display); },
        setElementDisplay: ({ id, display: target }) => { controller.setElementDisplay(id, target); return controller.controlState(display); },
        setHomeDisplay: ({ display: target }) => { controller.setHomeDisplay(target); return controller.controlState(display); },
        setElementPosition: ({ id, x, y }) => { controller.setElementPosition(id, x, y); return controller.controlState(display); },
        setElementBounds: ({ id, x, y, width, height }) => { controller.setElementBounds(id, { x, y, width, height }); return controller.controlState(display); },
        setElementPlacement: ({ id, display: target, x, y }) => { controller.setElementPlacement(id, target, x, y); return controller.controlState(display); },
        setElementOpacity: ({ id, opacity }) => { controller.setElementOpacity(id, opacity); return controller.controlState(display); },
        setOverlayVisible: ({ visible }) => { controller.setOverlayVisible(visible); return controller.controlState(display); },
        setShortcut: ({ action, shortcut }) => { controller.setShortcut(action, shortcut); return controller.controlState(display); },
        resetShortcutsToDefaults: () => { controller.resetShortcutsToDefaults(); return controller.controlState(display); },
        setRequiredStatuses: ({ category, statusIds }) => { controller.setRequiredStatuses(category, statusIds); return controller.controlState(display); },
        resetXpTracker: () => controller.resetXpTracker(),
        resetGoldTracker: () => controller.resetGoldTracker(),
        setMinimapRarityFilter: ({ rarity }) => controller.setMinimapRarityFilter(rarity),
        setMinimapLootChanceFilter: ({ chance }) => controller.setMinimapLootChanceFilter(chance),
      },
      messages: {
        dragPreview: (preview) => controller.relayDragPreview(preview),
        dragPreviewEnded: () => controller.relayDragPreview(undefined),
      },
    },
  });
  rpc.setTransport(session.transport());
  if (processId !== undefined) {
    void session.command("setAlwaysOnTop", { enabled: true }).then(
      () => configureOverlayWindow(processId, controller.locked),
      () => false,
    ).then((ready) => {
        log?.(`overlay native setup: display=${display} pid=${processId} ready=${ready}`);
        clickThroughReady = ready || !controller.locked;
        syncVisibility();
        if (!ready && controller.locked) console.error(`[neutralino-poc] kept locked overlay hidden: HWND setup failed for PID ${processId}`);
      });
  }

  const sink: OverlaySurfaceSink = {
    display,
    setClickThrough: (locked) => {
      if (locked) {
        clickThroughReady = false;
        void session.command("hide").catch(() => {});
      }
      if (processId === undefined) {
        clickThroughReady = !locked;
        syncVisibility();
        return;
      }
      void configureOverlayWindow(processId, locked).then((ready) => {
        clickThroughReady = ready || !locked;
        syncVisibility();
      });
    },
    setVisible: (visible) => {
      requestedVisible = visible;
      syncVisibility();
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
  if (processId === undefined) void session.command("setAlwaysOnTop", { enabled: true });
  syncVisibility();
  return sink;

  function syncVisibility(): void {
    const visible = requestedVisible && clickThroughReady;
    if (visible === lastAppliedVisibility) return;
    if (processId !== undefined) {
      if (!setOverlayWindowVisible(processId, visible, surfaceBounds)) {
        log?.(`overlay native visibility pending: display=${display} visible=${visible}`);
        return;
      }
      lastAppliedVisibility = visible;
      log?.(`overlay visibility applied: display=${display} visible=${visible}`);
      return;
    }
    lastAppliedVisibility = visible;
    void session.command(visible ? "show" : "hide").then(
      () => log?.(`overlay visibility applied: display=${display} visible=${visible}`),
      (error) => log?.(`overlay visibility failed: display=${display} visible=${visible} error=${error instanceof Error ? error.message : String(error)}`),
    );
  }
}
