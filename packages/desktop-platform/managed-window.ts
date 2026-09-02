import { BrowserWindow } from "@svoverlay/desktop-runtime";
import type { WindowFrame } from "@svoverlay/ui-kit/window-chrome";

import { mountRoundedWindow } from "./window-publish.ts";
import { registerUiScaleWindow } from "./ui-scale-window.ts";
import { registerLocaleWindow } from "./locale-window.ts";
import { frameClamp, type WindowPlacementStore } from "./window-placement.ts";
import type { WindowMinimumSize } from "./window-placement-frame.ts";
import { DisposableStore, onWindowEvent, onceWindowEvent } from "./window-lifecycle.ts";

type ManagedRpc = ConstructorParameters<typeof BrowserWindow>[0]["rpc"];

export interface ManagedWindow {
  window: BrowserWindow;
  /** Disposed automatically when the window closes; add view subscriptions and other teardown here. */
  lifecycle: DisposableStore;
}

interface ManagedWindowBase {
  title: string;
  url: string;
  rpc: ManagedRpc;
  minimum: WindowMinimumSize;
  /** Runs inside the window "close" event, after the lifecycle has been disposed. */
  onClose?: () => void;
}

/** A window whose frame is remembered in the shared placement store. */
export interface PlacementTrackedWindowOptions extends ManagedWindowBase {
  placements: WindowPlacementStore | undefined;
  placementKey: string;
  defaultFrame: WindowFrame;
}

/** A window whose frame is persisted by the caller (its own settings file). */
export interface SettingsPersistedWindowOptions extends ManagedWindowBase {
  /** Already resolved to physical pixels, e.g. via `visibleScaledWindowFrame`. */
  frame: WindowFrame;
  alwaysOnTop?: boolean;
  /** Receives the unscaled, minimum-clamped frame on every move and resize. */
  onFrameChange: (logicalFrame: WindowFrame) => void;
}

export type ManagedWindowOptions = PlacementTrackedWindowOptions | SettingsPersistedWindowOptions;

function isPlacementTracked(options: ManagedWindowOptions): options is PlacementTrackedWindowOptions {
  return "placementKey" in options;
}

export function createManagedWindow(options: ManagedWindowOptions): ManagedWindow {
  const { minimum } = options;
  const frame = isPlacementTracked(options)
    ? options.placements?.frame(options.placementKey, options.defaultFrame, minimum) ?? options.defaultFrame
    : options.frame;

  const window = new BrowserWindow({
    title: options.title,
    url: options.url,
    frame,
    titleBarStyle: "hidden",
    transparent: false,
    rpc: options.rpc,
  });
  if (!isPlacementTracked(options) && options.alwaysOnTop) window.setAlwaysOnTop(true);
  mountRoundedWindow(window);

  const lifecycle = new DisposableStore();
  lifecycle.add(registerUiScaleWindow(window, {
    scaleInitialFrame: isPlacementTracked(options) ? !options.placements : false,
  }));
  lifecycle.add(registerLocaleWindow(window));

  const clamp = frameClamp(minimum.width, minimum.height);

  if (isPlacementTracked(options)) {
    const disposePlacement = options.placements?.track(options.placementKey, window);
    if (disposePlacement) lifecycle.add(disposePlacement);
    lifecycle.add(onWindowEvent(window, "resize", (event: { data: WindowFrame }) => {
      const physical = clamp.clampPhysical(event.data);
      if (physical.width !== event.data.width || physical.height !== event.data.height) {
        window.setSize(physical.width, physical.height);
      }
    }));
  } else {
    const persist = (data: WindowFrame): void => {
      if (window.isMaximized()) return;
      const physical = clamp.clampPhysical(data);
      if (physical.width !== data.width || physical.height !== data.height) {
        window.setSize(physical.width, physical.height);
      }
      options.onFrameChange(clamp.unscale(physical));
    };
    lifecycle.add(onWindowEvent(window, "move", (event: { data: WindowFrame }) => persist(event.data)));
    lifecycle.add(onWindowEvent(window, "resize", (event: { data: WindowFrame }) => persist(event.data)));
  }

  lifecycle.add(onceWindowEvent(window, "close", () => {
    lifecycle.dispose();
    options.onClose?.();
  }));

  return { window, lifecycle };
}
