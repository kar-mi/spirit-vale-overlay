import { BrowserView, BrowserWindow } from "@svoverlay/desktop-runtime";
import { applyRoundedCorners, setWindowIcon } from "@svoverlay/desktop-platform/win32";
import { appIconPath } from "@svoverlay/desktop-platform/window-publish";
import type { CharacterViewState } from "@kar-mi/spirit-vale-tools-character";
import type { CharacterRpc } from "../character/rpc.ts";
import { registerUiScaleWindow, scaledSize } from "@svoverlay/desktop-platform/ui-scale-window";
import { registerLocaleWindow } from "@svoverlay/desktop-platform/locale-window";
import { translate } from "@svoverlay/i18n/backend";
import type { WindowPlacementStore } from "@svoverlay/desktop-platform/window-placement";
import { DisposableStore, onWindowEvent, onceWindowEvent } from "@svoverlay/desktop-platform/window-lifecycle";

export interface CharacterWindowOptions {
  getState: () => CharacterViewState;
  subscribe: (listener: (state: CharacterViewState) => void) => () => void;
  placements?: WindowPlacementStore;
  onClosed?: () => void;
  onOpenSettings?: () => void;
}

export async function createCharacterWindow(options: CharacterWindowOptions) {
  let window: BrowserWindow;
  let closing = false;
  const lifecycle = new DisposableStore();
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

  window = new BrowserWindow({
    title: translate("character.window.title"),
    url: "views://characterview/index.html",
    frame: options.placements?.frame(
      "character",
      { x: 140, y: 100, width: 1120, height: 973 },
      { width: 680, height: 520 },
    ) ?? { x: 140, y: 100, width: 1120, height: 973 },
    titleBarStyle: "hidden",
    transparent: false,
    rpc,
  });
  applyRoundedCorners(window.ptr);
  setWindowIcon(window.ptr, appIconPath);
  lifecycle.add(registerUiScaleWindow(window, { scaleInitialFrame: !options.placements }));
  lifecycle.add(registerLocaleWindow(window));
  const disposePlacement = options.placements?.track("character", window);
  if (disposePlacement) lifecycle.add(disposePlacement);
  const unsubscribe = options.subscribe((state) => {
    try { rpc.send.stateChanged(state); } catch { /* View may still be connecting. */ }
  });
  lifecycle.add(unsubscribe);
  lifecycle.add(onWindowEvent(window, "resize", (event: { data: { width: number; height: number } }) => {
    const width = Math.max(scaledSize(680), event.data.width);
    const height = Math.max(scaledSize(520), event.data.height);
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
