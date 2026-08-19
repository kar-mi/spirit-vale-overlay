import type {
  KeybindAction,
  OverlayElementId,
  OverlaySettingsState,
  PersonalDpsMode,
  RequiredStatusCategory,
} from "../app-types.ts";
import { displayKey, type OverlayDisplay } from "../display-layout.ts";
import { createOverlayController, type OverlayControllerOptions } from "./controller.ts";
import { createOverlaySurface, type OverlaySurface } from "./surface.ts";

export type { XpTrackerSource } from "./controller.ts";
export type OverlayWindowOptions = OverlayControllerOptions & { onClosed?: () => void };

/**
 * The overlay as the rest of the app sees it: one handle, however many monitors it spans.
 *
 * Underneath it is a single controller (log pipeline, settings, global shortcuts) plus one window
 * per display that actually has an enabled tile. A display with no tiles gets no window at all,
 * which is what lets a game on that monitor keep DWM's independent-flip present mode.
 */
export async function createOverlayWindow(options: OverlayWindowOptions) {
  const surfaces = new Map<string, OverlaySurface>();
  let closedCallbackSent = false;
  let reconciling = false;
  let reconcileTimer: ReturnType<typeof setTimeout> | undefined;
  let closing = false;

  const controller = await createOverlayController({
    ...options,
    onSurfacesChanged: () => scheduleReconcile(),
  });

  reconcileSurfaces();
  controller.start();

  return {
    show: () => controller.setOverlayVisible(true),
    activate: () => controller.setOverlayVisible(true),
    close: async () => {
      // Set before awaiting: a reconcile scheduled by the last settings flush would otherwise fire
      // during the await and rebuild the very windows this is tearing down.
      closing = true;
      if (reconcileTimer !== undefined) clearTimeout(reconcileTimer);
      reconcileTimer = undefined;
      await controller.shutdown();
      for (const surface of [...surfaces.values()]) surface.close();
      surfaces.clear();
      notifyClosed();
    },
    getSettingsState: (): OverlaySettingsState => controller.settingsState(),
    setLocked: (locked: boolean) => controller.updateLocked(locked),
    setElementEnabled: (id: OverlayElementId, enabled: boolean) => controller.setElementEnabled(id, enabled),
    setElementDisplay: (id: OverlayElementId, display: string) => controller.setElementDisplay(id, display),
    setHomeDisplay: (display: string) => controller.setHomeDisplay(display),
    setOverlayVisible: (visible: boolean) => controller.setOverlayVisible(visible),
    setAutoHideWhenUnfocused: (enabled: boolean) => controller.setAutoHideWhenUnfocused(enabled),
    setKeybindsRequireGameFocus: (enabled: boolean) => controller.setKeybindsRequireGameFocus(enabled),
    setShortcut: (action: KeybindAction, shortcut: string) => controller.setShortcut(action, shortcut),
    resetShortcutsToDefaults: () => controller.resetShortcutsToDefaults(),
    setShortcutCapture: (active: boolean) => controller.setShortcutCapture(active),
    setRequiredStatuses: (category: RequiredStatusCategory, statusIds: string[]) =>
      controller.setRequiredStatuses(category, statusIds),
    setPersonalDpsMode: (mode: PersonalDpsMode) => controller.setPersonalDpsMode(mode),
    setMinimapRarityFilter: (rarity: number) => controller.setMinimapRarityFilter(rarity),
  };

  /**
   * Most reconciles are triggered from inside an RPC handler — locking, or enabling the last tile
   * on a monitor — and closing a window synchronously there would destroy the webview the response
   * still has to go back through. Deferring to a macrotask lets the handler return first, and
   * coalesces the burst of settings changes a single gesture produces into one pass.
   */
  function scheduleReconcile(): void {
    if (closing || reconcileTimer !== undefined) return;
    reconcileTimer = setTimeout(() => {
      reconcileTimer = undefined;
      reconcileSurfaces();
    }, 0);
    // Never let a pending reconcile be the reason the process stays alive.
    reconcileTimer.unref?.();
  }

  /** Brings the live window set in line with the displays that currently hold an enabled tile. */
  function reconcileSurfaces(): void {
    // Creating a surface publishes control state, which can re-enter here; one pass is enough.
    if (closing || reconciling) return;
    reconciling = true;
    try {
      const wanted = new Set(controller.wantedSurfaces());
      const connected = new Map(controller.displays.map((display) => [displayKey(display), display] as const));
      for (const [key, surface] of [...surfaces]) {
        if (wanted.has(key) && connected.has(key)) continue;
        surfaces.delete(key);
        surface.close();
      }
      for (const key of wanted) {
        const display: OverlayDisplay | undefined = connected.get(key);
        if (!display || surfaces.has(key)) continue;
        surfaces.set(key, createOverlaySurface({
          controller,
          display,
          onClosed: (closedKey) => {
            surfaces.delete(closedKey);
            // The user closed the last overlay window: treat that as closing the overlay, which is
            // what the single-window build did.
            if (surfaces.size === 0) {
              void controller.shutdown();
              notifyClosed();
            }
          },
        }));
      }
    } finally {
      reconciling = false;
    }
  }

  function notifyClosed(): void {
    if (closedCallbackSent) return;
    closedCallbackSent = true;
    options.onClosed?.();
  }
}

export type { OverlayElementId };
