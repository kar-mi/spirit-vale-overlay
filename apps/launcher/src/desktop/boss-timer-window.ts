import { BrowserView, BrowserWindow } from "@svoverlay/desktop-runtime";
import { applyRoundedCorners, setWindowIcon } from "@svoverlay/desktop-platform/win32";
import { appIconPath } from "@svoverlay/desktop-platform/window-publish";
import { registerUiScaleWindow, scaledSize } from "@svoverlay/desktop-platform/ui-scale-window";
import type { WindowPlacementStore } from "@svoverlay/desktop-platform/window-placement";
import { DisposableStore, onWindowEvent, onceWindowEvent } from "@svoverlay/desktop-platform/window-lifecycle";

import type { BossTimerRpc, BossTimerWindowState } from "../boss-timers/rpc.ts";

export interface BossTimerWindowOptions {
  getState: () => BossTimerWindowState;
  subscribe: (listener: () => void) => () => void;
  addTimer: (entry: { mobId: string; channel: number; region?: string; diedAtMs: number }) => void;
  removeTimer: (id: string) => void;
  placements?: WindowPlacementStore;
  onClosed?: () => void;
  onOpenSettings?: () => void;
}

export async function createBossTimerWindow(options: BossTimerWindowOptions) {
  let window: BrowserWindow;
  let closing = false;
  const lifecycle = new DisposableStore();
  const rpc = BrowserView.defineRPC<BossTimerRpc>({
    handlers: {
      requests: {
        getState: () => options.getState(),
        addTimer: (entry) => {
          options.addTimer(entry);
          return options.getState();
        },
        removeTimer: ({ id }) => {
          options.removeTimer(id);
          return options.getState();
        },
        openSettings: () => { options.onOpenSettings?.(); },
        windowAction: ({ action }) => {
          if (action === "minimize") window.minimize();
          else window.close();
        },
        getWindowFrame: () => window.getFrame(),
        setWindowFrame: ({ x, y, width, height }) => window.setFrame(x, y, width, height),
      },
      messages: {},
    },
  });

  window = new BrowserWindow({
    title: "Spirit Vale Boss Timers",
    url: "views://bosstimersview/index.html",
    frame: options.placements?.frame(
      "boss-timers",
      { x: 170, y: 130, width: 860, height: 660 },
      { width: 620, height: 420 },
    ) ?? { x: 170, y: 130, width: 860, height: 660 },
    titleBarStyle: "hidden",
    transparent: false,
    rpc,
  });
  applyRoundedCorners(window.ptr);
  setWindowIcon(window.ptr, appIconPath);
  lifecycle.add(registerUiScaleWindow(window, { scaleInitialFrame: !options.placements }));
  const disposePlacement = options.placements?.track("boss-timers", window);
  if (disposePlacement) lifecycle.add(disposePlacement);
  const unsubscribe = options.subscribe(() => {
    try { rpc.send.stateChanged(options.getState()); } catch { /* View may still be connecting. */ }
  });
  lifecycle.add(unsubscribe);
  lifecycle.add(onWindowEvent(window, "resize", (event: { data: { width: number; height: number } }) => {
    const width = Math.max(scaledSize(620), event.data.width);
    const height = Math.max(scaledSize(420), event.data.height);
    if (width !== event.data.width || height !== event.data.height) window.setSize(width, height);
  }));
  lifecycle.add(onceWindowEvent(window, "close", () => {
    if (closing) return;
    closing = true;
    lifecycle.dispose();
    options.onClosed?.();
  }));
  return {
    show: () => window.show(),
    activate: () => window.activate(),
    close: async () => { window.close(); },
  };
}
