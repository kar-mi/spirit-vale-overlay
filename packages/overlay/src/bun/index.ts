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

export type { BossTimerSource, XpTrackerSource } from "./controller.ts";
export type OverlayWindowOptions = OverlayControllerOptions & { onClosed?: () => void };

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
    setMinimapLootChanceFilter: (chance: number) => controller.setMinimapLootChanceFilter(chance),
  };

  function scheduleReconcile(): void {
    if (closing || reconcileTimer !== undefined) return;
    reconcileTimer = setTimeout(() => {
      reconcileTimer = undefined;
      reconcileSurfaces();
    }, 0);
    // Never let a pending reconcile be the reason the process stays alive.
    reconcileTimer.unref?.();
  }

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
            // Closing the last surface closes the overlay.
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
