import { BrowserView } from "@svoverlay/desktop-runtime";
import { translate } from "@svoverlay/i18n/backend";
import type { WindowPlacementStore } from "@svoverlay/desktop-platform/window-placement";
import { createManagedWindow } from "@svoverlay/desktop-platform/managed-window";

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

  const { window, lifecycle } = createManagedWindow({
    title: translate("bossTimers.window.title"),
    url: "views://bosstimersview/index.html",
    rpc,
    minimum: { width: 620, height: 420 },
    placements: options.placements,
    placementKey: "boss-timers",
    defaultFrame: { x: 170, y: 130, width: 860, height: 660 },
    onClose: () => { options.onClosed?.(); },
  });
  lifecycle.add(options.subscribe(() => {
    try { rpc.send.stateChanged(options.getState()); } catch { /* View may still be connecting. */ }
  }));

  return {
    show: () => window.show(),
    activate: () => window.activate(),
    close: async () => { window.close(); },
  };
}
