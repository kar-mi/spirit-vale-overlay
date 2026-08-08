import { BrowserView, BrowserWindow, Utils } from "electrobun/bun";
import { applyRoundedCorners, setWindowIcon } from "@svoverlay/desktop-platform/win32";
import { appIconPath } from "@svoverlay/desktop-platform/window-publish";
import { registerUiScaleWindow, scaledSize } from "@svoverlay/desktop-platform/ui-scale-window";
import type { WindowPlacementStore } from "@svoverlay/desktop-platform/window-placement";
import { DisposableStore, onWindowEvent, onceWindowEvent } from "@svoverlay/desktop-platform/window-lifecycle";
import type { CharacterSnapshot } from "@kar-mi/spirit-vale-tools-character";

import type { BuildExportRpc, BuildExportSource, BuildExportState, BuildExportUnresolvedGroup } from "../app-types.ts";
import { buildExportCatalog } from "../catalog.ts";
import { buildPlannerLink, SITE_ORIGIN } from "../site-links.ts";
import { snapshotToBuild } from "../snapshot-to-build.ts";

const MINIMUM_WIDTH = 520;
const MINIMUM_HEIGHT = 520;

export interface InspectedCharacterEntry {
  snapshot: CharacterSnapshot;
  inspectedAt: string;
}

export interface BuildExportWindowOptions {
  /**
   * The local player's character. Deliberately a provider rather than a fixed source: the
   * translation does not care whose character it is.
   */
  getCharacter: () => CharacterSnapshot | undefined;
  subscribeCharacter: (listener: () => void) => () => void;
  /** Players seen via the inspect RPC, most recently inspected first. */
  getInspected?: () => InspectedCharacterEntry[];
  subscribeInspected?: (listener: () => void) => () => void;
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

  let selectedId = "self";

  /** Your character first, then inspected players most-recent first. */
  const sources = (): BuildExportSource[] => {
    const list: BuildExportSource[] = [];
    const own = options.getCharacter();
    if (own) {
      list.push({ id: "self", name: own.name, kind: "self", cls: own.archetypes.at(-1) ?? "", level: own.level });
    }
    for (const entry of options.getInspected?.() ?? []) {
      // Inspecting yourself would otherwise produce a duplicate of the entry above.
      if (own && entry.snapshot.name === own.name) continue;
      list.push({
        id: `inspect:${entry.snapshot.name}`,
        name: entry.snapshot.name,
        kind: "inspected",
        cls: entry.snapshot.archetypes.at(-1) ?? "",
        level: entry.snapshot.level,
        inspectedAt: entry.inspectedAt,
      });
    }
    return list;
  };

  const snapshotFor = (id: string): CharacterSnapshot | undefined => {
    if (id === "self") return options.getCharacter();
    const name = id.startsWith("inspect:") ? id.slice("inspect:".length) : undefined;
    if (name === undefined) return undefined;
    return options.getInspected?.().find((entry) => entry.snapshot.name === name)?.snapshot;
  };

  const translate = () => {
    const character = snapshotFor(selectedId);
    return character ? snapshotToBuild(character, { catalog }) : undefined;
  };

  const appState = (): BuildExportState => {
    const available = sources();
    // A selected player can age out of the roster; fall back rather than showing an empty panel.
    if (!available.some((entry) => entry.id === selectedId)) selectedId = available[0]?.id ?? "self";
    const result = translate();
    const selected = available.find((entry) => entry.id === selectedId);
    const base = {
      sources: available,
      selectedId,
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
        statusDetail: "Waiting for character data. Log in, or change map, and the game will send it. Inspect another player to add them here.",
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
        ...(selected?.kind === "inspected" ? { inspectedAt: selected.inspectedAt } : {}),
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
        selectCharacter: ({ id }) => {
          selectedId = id;
          return appState();
        },
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
  if (options.subscribeInspected) lifecycle.add(options.subscribeInspected(() => publish()));
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
