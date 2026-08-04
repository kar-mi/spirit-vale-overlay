import { BrowserView, BrowserWindow, Utils } from "electrobun/bun";
import { applyRoundedCorners, setWindowIcon } from "@spiritvale/ui-core/win32";
import { appIconPath } from "@spiritvale/ui-core/window-publish";
import { registerUiScaleWindow, scaledSize } from "@spiritvale/ui-core/ui-scale-window";
import type { WindowPlacementStore } from "@spiritvale/ui-core/window-placement";
import { DisposableStore, onWindowEvent, onceWindowEvent } from "@spiritvale/ui-core/window-lifecycle";
import type { CharacterSnapshot } from "@kar-mi/spirit-vale-tools-character";

import type { BuildExportRpc, BuildExportState, BuildExportUnresolvedGroup } from "../app-types.ts";
import { buildExportCatalog } from "../catalog.ts";
import { buildPlannerLink, SITE_ORIGIN } from "../site-links.ts";
import { snapshotToBuild } from "../snapshot-to-build.ts";

const MINIMUM_WIDTH = 520;
const MINIMUM_HEIGHT = 520;

export interface BuildExportWindowOptions {
  /**
   * The character to export. Deliberately a provider rather than a fixed source: the translation
   * does not care whose character it is, so a future "export the player you just inspected" only
   * has to supply a different snapshot here.
   */
  getCharacter: () => CharacterSnapshot | undefined;
  subscribeCharacter: (listener: () => void) => () => void;
  /** Overridable so a local site checkout can be targeted during development. */
  origin?: string;
  placements?: WindowPlacementStore;
  onClosed?: () => void;
  onOpenSettings?: () => void;
}

export function createBuildExportWindow(options: BuildExportWindowOptions) {
  const catalog = buildExportCatalog();
  const origin = options.origin ?? SITE_ORIGIN;
  let window: BrowserWindow;
  let closing = false;
  let lastExportedAt: string | undefined;
  const lifecycle = new DisposableStore();

  const translate = () => {
    const character = options.getCharacter();
    return character ? snapshotToBuild(character, { catalog }) : undefined;
  };

  const appState = (): BuildExportState => {
    const result = translate();
    const base = {
      unresolved: [] as BuildExportUnresolvedGroup[],
      missing: 0,
      notes: [] as string[],
      snapshotGameBuild: catalog.snapshot.gameBuild,
      snapshotGameLabel: catalog.snapshot.gameLabel,
      snapshotGeneratedAt: catalog.snapshot.generatedAt,
      attribution: catalog.snapshot.attribution,
      siteOrigin: origin,
      ...(lastExportedAt ? { lastExportedAt } : {}),
    };
    if (!result) {
      return {
        ...base,
        status: "waiting",
        statusDetail: "Waiting for character data. Log in, or change map, and the game will send it.",
      };
    }

    const { build, unresolved, missing, notes } = result;
    const equipment = Object.values(build.eq);
    const artifacts = Object.values(build.arti).filter((piece) => piece !== null);
    return {
      ...base,
      status: "ready",
      statusDetail: missing === 0
        ? "Every item resolved."
        : `${missing} ${missing === 1 ? "entry" : "entries"} could not be matched and will be left out.`,
      character: {
        name: build.name || "Unnamed character",
        cls: build.cls,
        ...(build.base ? { base: build.base } : {}),
        level: build.lv,
        jobLevel: build.job,
        equipmentCount: equipment.length,
        artifactCount: artifacts.length,
        gemCount: artifacts.filter((piece) => piece?.gem).length,
        cardCount: equipment.reduce((total, item) => total + item.cards.filter(Boolean).length, 0),
        skillCount: Object.keys(build.skills).length,
        grimoireCount: build.grim.filter(Boolean).length,
        ...(build.wload ? { weaponSetCount: build.wload.filter((set) => set.mainhand ?? set.offhand).length } : {}),
      },
      unresolved: Object.entries(unresolved)
        .filter(([, items]) => items.length)
        .map(([group, items]) => ({ group, items })),
      missing,
      notes,
    };
  };

  const publish = () => {
    try {
      rpc.send.stateChanged(appState());
    } catch {
      /* The view may still be connecting. */
    }
  };

  const rpc = BrowserView.defineRPC<BuildExportRpc>({
    maxRequestTime: 30_000,
    handlers: {
      requests: {
        getState: () => appState(),
        exportToPlanner: () => {
          const result = translate();
          if (result) {
            Utils.openExternal(buildPlannerLink(result.build, origin));
            lastExportedAt = new Date().toISOString();
          }
          return appState();
        },
        getPlannerLink: () => {
          const result = translate();
          return { link: result ? buildPlannerLink(result.build, origin) : "" };
        },
        openSite: () => { Utils.openExternal(origin); },
        openSettings: () => { options.onOpenSettings?.(); },
        windowAction: ({ action }) => {
          if (action === "minimize") window.minimize();
          else window.close();
        },
        getWindowFrame: () => window.getFrame(),
        setWindowFrame: ({ x, y, width, height }) => { window.setFrame(x, y, width, height); },
      },
      messages: {},
    },
  });

  window = new BrowserWindow({
    title: "Spirit Vale Build Export",
    url: "views://buildexportview/index.html",
    frame: options.placements?.frame(
      "build-export",
      { x: 160, y: 120, width: 620, height: 720 },
      { width: MINIMUM_WIDTH, height: MINIMUM_HEIGHT },
    ) ?? { x: 160, y: 120, width: 620, height: 720 },
    titleBarStyle: "hidden",
    transparent: false,
    rpc,
  });
  applyRoundedCorners(window.ptr);
  setWindowIcon(window.ptr, appIconPath);
  lifecycle.add(registerUiScaleWindow(window, { scaleInitialFrame: !options.placements }));
  const disposePlacement = options.placements?.track("build-export", window);
  if (disposePlacement) lifecycle.add(disposePlacement);
  lifecycle.add(options.subscribeCharacter(() => publish()));
  lifecycle.add(onWindowEvent(window, "resize", (event: { data: { width: number; height: number } }) => {
    const width = Math.max(scaledSize(MINIMUM_WIDTH), event.data.width);
    const height = Math.max(scaledSize(MINIMUM_HEIGHT), event.data.height);
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
