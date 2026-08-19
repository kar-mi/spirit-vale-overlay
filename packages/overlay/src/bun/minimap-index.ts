import { Screen } from "electrobun/bun";
import { SafeSaveQueue } from "@svoverlay/desktop-platform/safe-save";
import type { FishNetPosition } from "@kar-mi/spirit-vale-tools-combat";
import type { FishNetLootDrop } from "@kar-mi/spirit-vale-tools-rewards";

import { displayForRect } from "../display-layout.ts";
import { loadMinimapSettings, normalizeMinimapSettings, saveMinimapSettings, type MinimapSettings } from "../minimap-settings.ts";
import type { MinimapState } from "../minimap-types.ts";
import { createMinimapSurface, type MinimapSurfaceFrame } from "./minimap-surface.ts";

/** Raw tracker snapshot the capture pipeline publishes; see `CaptureMinimapState` in the desktop app. */
export interface MinimapSourceState {
  self: FishNetPosition | undefined;
  loot: FishNetLootDrop[];
}

export interface MinimapWindowOptions {
  settingsPath?: string;
  subscribeMinimap: (listener: (state: MinimapSourceState) => void) => () => void;
  /** Bounds of the game window, so the minimap opens on the same monitor. Re-resolved on each toggle-open. */
  getGameWindowRect?: () => MinimapSurfaceFrame | undefined;
}

export type MinimapWindow = Awaited<ReturnType<typeof createMinimapWindow>>;

const MINIMAP_SIZE = { width: 340, height: 340 };

/**
 * The minimap as the rest of the app sees it: created once, hidden, at startup, so pressing Tab is
 * an instant visibility flip rather than a create-on-demand flow.
 */
export async function createMinimapWindow(options: MinimapWindowOptions) {
  let settings = await loadMinimapSettings(options.settingsPath);
  let latest: MinimapSourceState = { self: undefined, loot: [] };
  let visible = false;
  let closed = false;

  const persistence = new SafeSaveQueue<MinimapSettings>({
    label: "minimap settings",
    save: (value) => saveMinimapSettings(value, options.settingsPath),
    onWarning: () => {},
  });

  const surface = createMinimapSurface({
    frame: resolveFrame(),
    getState: () => state(),
    setRarityFilter: (rarity) => { setRarityFilter(rarity); return state(); },
  });

  const unsubscribe = options.subscribeMinimap((next) => {
    latest = next;
    publish();
  });

  return {
    show,
    toggle: () => { if (visible) hide(); else show(); },
    setRarityFilter,
    getRarityFilter: () => settings.rarityFilter,
    close: async () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      await persistence.flush(settings);
      surface.close();
    },
  };

  function setRarityFilter(rarity: number): void {
    settings = normalizeMinimapSettings({ ...settings, rarityFilter: rarity });
    persistence.schedule(settings);
    publish();
  }

  function show(): void {
    visible = true;
    surface.setFrame(resolveFrame());
    surface.show();
    publish();
  }

  function hide(): void {
    visible = false;
    surface.hide();
  }

  function state(): MinimapState {
    return {
      visible,
      player: latest.self ? { x: latest.self.x, z: latest.self.z } : undefined,
      loot: latest.loot.flatMap((drop) => (drop.position === undefined ? [] : [{
        objectId: drop.objectId,
        x: drop.position[0],
        z: drop.position[2],
        ...(drop.displayName === undefined ? {} : { displayName: drop.displayName }),
        ...(drop.spriteId === undefined ? {} : { spriteId: drop.spriteId }),
        ...(drop.rarity === undefined ? {} : { rarity: drop.rarity }),
        ...(drop.lootType === undefined ? {} : { lootType: drop.lootType }),
      }])),
      rarityFilter: settings.rarityFilter,
    };
  }

  function publish(): void {
    if (closed) return;
    surface.publish(state());
  }

  /** Centers the minimap on whichever display the game window is on, re-resolved per open. */
  function resolveFrame(): MinimapSurfaceFrame {
    const gameRect = options.getGameWindowRect?.();
    const displays = Screen.getAllDisplays();
    const display = (gameRect ? displayForRect(displays.length > 0 ? displays : [Screen.getPrimaryDisplay()], gameRect) : undefined)
      ?? (displays[0] ?? Screen.getPrimaryDisplay());
    return {
      x: Math.round(display.bounds.x + (display.bounds.width - MINIMAP_SIZE.width) / 2),
      y: Math.round(display.bounds.y + (display.bounds.height - MINIMAP_SIZE.height) / 2),
      width: MINIMAP_SIZE.width,
      height: MINIMAP_SIZE.height,
    };
  }
}
