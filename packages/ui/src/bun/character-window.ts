import Electrobun, { BrowserView, BrowserWindow } from "electrobun/bun";
import { applyRoundedCorners } from "@spiritvale/ui-core/win32";
import type { CharacterViewState } from "@kar-mi/spirit-vale-tools-character";
import type { CharacterRpc } from "../character-types.ts";
import { registerUiScaleWindow, scaledSize } from "@spiritvale/ui-core/ui-scale";
import type { WindowPlacementStore } from "@spiritvale/ui-core/window-placement";

export interface CharacterWindowOptions {
  getState: () => CharacterViewState;
  subscribe: (listener: (state: CharacterViewState) => void) => () => void;
  placements?: WindowPlacementStore;
  onClosed?: () => void;
}

export async function createCharacterWindow(options: CharacterWindowOptions) {
  let window: BrowserWindow;
  let closing = false;
  const rpc = BrowserView.defineRPC<CharacterRpc>({
    handlers: {
      requests: {
        getState: () => options.getState(),
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
    title: "Spirit Vale Character",
    url: "views://characterview/index.html",
    frame: options.placements?.frame(
      "character",
      { x: 140, y: 100, width: 976, height: 813 },
      { width: 680, height: 520 },
    ) ?? { x: 140, y: 100, width: 976, height: 813 },
    titleBarStyle: "hidden",
    transparent: false,
    rpc,
  });
  applyRoundedCorners(window.ptr);
  registerUiScaleWindow(window, { scaleInitialFrame: !options.placements });
  options.placements?.track("character", window);
  const unsubscribe = options.subscribe((state) => {
    try { rpc.send.stateChanged(state); } catch { /* View may still be connecting. */ }
  });
  Electrobun.events.on(`resize-${window.id}`, (event: { data: { width: number; height: number } }) => {
    const width = Math.max(scaledSize(680), event.data.width);
    const height = Math.max(scaledSize(520), event.data.height);
    if (width !== event.data.width || height !== event.data.height) window.setSize(width, height);
  });
  window.on("close", () => {
    if (closing) return;
    closing = true;
    unsubscribe();
    options.onClosed?.();
  });
  return {
    show: () => window.show(),
    activate: () => window.activate(),
    close: async () => { unsubscribe(); closing = true; window.close(); },
  };
}
