import { BrowserView } from "@svoverlay/desktop-runtime";
import type { BrowserWindow } from "@svoverlay/desktop-runtime";
import { createManagedWindow } from "@svoverlay/desktop-platform/managed-window";
import type { DisposableStore } from "@svoverlay/desktop-platform/disposable-store";
import { publishSafely } from "@svoverlay/desktop-platform/window-publish";
import { visibleScaledWindowFrame } from "@svoverlay/desktop-platform/window-placement";
import { loadBundledMobRewardCatalog, queryMobRewardCatalog } from "@kar-mi/spirit-vale-tools-rewards";

import type { RewardsCatalogRpc, RewardsCatalogState } from "../app-types.ts";
import type { RewardsAppSettings } from "../settings.ts";

const MINIMUM = { width: 520, height: 420 } as const;

export interface RewardsCatalogWindow {
  open(): void;
  setAlwaysOnTop(pinned: boolean): void;
  close(): void;
}

export function createRewardsCatalogWindow(options: {
  settings: RewardsAppSettings;
  onOpenSettings?: () => void;
  onSettingsChanged: () => void;
}): RewardsCatalogWindow {
  const catalog = loadBundledMobRewardCatalog();
  let query = "";
  let window: BrowserWindow | undefined;
  let lifecycle: DisposableStore | undefined;

  const state = (): RewardsCatalogState => ({
    query,
    catalogCount: catalog.mobs.length,
    catalog: queryMobRewardCatalog(catalog, { text: query })
      .map((mob) => ({ ...mob, drops: mob.drops.map((drop) => ({ ...drop })) })),
  });
  const rpc = BrowserView.defineRPC<RewardsCatalogRpc>({
    handlers: { requests: {
      getState: state,
      openSettings: () => { options.onOpenSettings?.(); },
      setQuery: ({ query: next }) => {
        query = next.trim().slice(0, 200);
        publish();
        return state();
      },
      windowAction: ({ action }) => {
        if (action === "minimize") window?.minimize();
        else window?.close();
      },
      getWindowFrame: () => window?.getFrame() ?? options.settings.catalogFrame,
      setWindowFrame: ({ x, y, width, height }) => { window?.setFrame(x, y, width, height); },
      toggleMaximize: () => {
        if (!window) return { maximized: false };
        if (window.isMaximized()) window.unmaximize();
        else window.maximize();
        return { maximized: window.isMaximized() };
      },
    }, messages: {} },
  });

  const publish = (): void => publishSafely(() => rpc.send.stateChanged(state()));
  return {
    open: () => {
      if (window) {
        window.show();
        window.activate();
        return;
      }
      const managed = createManagedWindow({
        title: "Spirit Vale Mob Catalog",
        url: "views://rewardscatalogview/index.html",
        rpc,
        minimum: MINIMUM,
        alwaysOnTop: options.settings.pinned,
        frame: visibleScaledWindowFrame(options.settings.catalogFrame, MINIMUM),
        onFrameChange: (logical) => {
          options.settings.catalogFrame = logical;
          options.onSettingsChanged();
        },
        onClose: () => {
          if (window !== managed.window) return;
          window = undefined;
          lifecycle = undefined;
          options.onSettingsChanged();
        },
      });
      window = managed.window;
      lifecycle = managed.lifecycle;
    },
    setAlwaysOnTop: (pinned) => { window?.setAlwaysOnTop(pinned); },
    close: () => {
      lifecycle?.dispose();
      lifecycle = undefined;
      window?.close();
      window = undefined;
    },
  };
}
