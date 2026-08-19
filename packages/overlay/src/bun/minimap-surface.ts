import { hideWindowFromTaskbar, setWindowClickThrough } from "@svoverlay/desktop-platform/win32";
import { BrowserView, BrowserWindow } from "electrobun/bun";

import type { MinimapRpc, MinimapState } from "../minimap-types.ts";

export interface MinimapSurfaceFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MinimapSurfaceOptions {
  frame: MinimapSurfaceFrame;
  getState: () => MinimapState;
  setRarityFilter: (rarity: number) => MinimapState;
}

export interface MinimapSurface {
  show(): void;
  hide(): void;
  setFrame(frame: MinimapSurfaceFrame): void;
  publish(state: MinimapState): void;
  close(): void;
}

/**
 * The minimap's one window: transparent, always-on-top, and permanently click-through — it is
 * display-only, so unlike the main overlay there is no lock/unlock state to toggle native hit
 * testing for.
 */
export function createMinimapSurface({ frame, getState, setRarityFilter }: MinimapSurfaceOptions): MinimapSurface {
  const rpc = BrowserView.defineRPC<MinimapRpc>({
    maxRequestTime: 30_000,
    handlers: {
      requests: {
        getState: () => getState(),
        setRarityFilter: ({ rarity }) => setRarityFilter(rarity),
      },
      messages: {},
    },
  });

  const window = new BrowserWindow({
    title: "Spirit Vale Minimap",
    url: "views://minimapview/index.html",
    frame,
    titleBarStyle: "hidden",
    transparent: true,
    hidden: true,
    rpc,
  });
  window.setAlwaysOnTop(true);
  hideWindowFromTaskbar(window.ptr);
  setWindowClickThrough(window.ptr, true);

  return {
    show: () => window.showInactive(),
    hide: () => window.hide(),
    setFrame: (next) => window.setFrame(next.x, next.y, next.width, next.height),
    publish: (state) => rpc.send.stateChanged(state),
    close: () => window.close(),
  };
}
