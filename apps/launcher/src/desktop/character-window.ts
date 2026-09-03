import { BrowserView } from "@svoverlay/desktop-runtime";
import type { CharacterViewState } from "@kar-mi/spirit-vale-tools-character";
import type { CharacterRpc } from "../character/rpc.ts";
import { translate } from "@svoverlay/i18n/backend";
import type { WindowPlacementStore } from "@svoverlay/desktop-platform/window-placement";
import { createManagedWindow } from "@svoverlay/desktop-platform/managed-window";

export interface CharacterWindowOptions {
  getState: () => CharacterViewState;
  subscribe: (listener: (state: CharacterViewState) => void) => () => void;
  placements?: WindowPlacementStore;
  onClosed?: () => void;
  onOpenSettings?: () => void;
}

export async function createCharacterWindow(options: CharacterWindowOptions) {
  const rpc = BrowserView.defineRPC<CharacterRpc>({
    handlers: {
      requests: {
        getState: () => options.getState(),
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
    title: translate("character.window.title"),
    url: "views://characterview/index.html",
    rpc,
    minimum: { width: 680, height: 520 },
    placements: options.placements,
    placementKey: "character",
    defaultFrame: { x: 140, y: 100, width: 1120, height: 973 },
    onClose: () => { options.onClosed?.(); },
  });
  lifecycle.add(options.subscribe((state) => {
    try { rpc.send.stateChanged(state); } catch { /* View may still be connecting. */ }
  }));

  return {
    show: () => window.show(),
    activate: () => window.activate(),
    close: async () => { window.close(); },
  };
}
