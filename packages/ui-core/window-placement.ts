import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import Electrobun, { BrowserWindow, Screen } from "electrobun/bun";

import { SafeSaveQueue } from "./safe-save.ts";
import { scaledSize, unscaledSize } from "./ui-scale.ts";
import type { WindowFrame } from "./window-chrome.ts";
import {
  isWindowFrame,
  visibleWindowFrame,
  type DisplayWorkArea,
  type WindowMinimumSize,
} from "./window-placement-frame.ts";

export { visibleWindowFrame } from "./window-placement-frame.ts";
export type { DisplayWorkArea, WindowMinimumSize } from "./window-placement-frame.ts";

interface StoredPlacements {
  frames: Record<string, WindowFrame>;
}

export interface WindowPlacementStoreOptions {
  onWarning?: (warning: string | undefined) => void;
  workAreas?: () => readonly DisplayWorkArea[];
}

const EMPTY_PLACEMENTS: StoredPlacements = { frames: {} };

export class WindowPlacementStore {
  private readonly persistence: SafeSaveQueue<StoredPlacements>;

  private constructor(
    file: string,
    private readonly placements: StoredPlacements,
    private readonly workAreas: () => readonly DisplayWorkArea[],
    onWarning: (warning: string | undefined) => void,
  ) {
    this.persistence = new SafeSaveQueue({
      label: "window placements",
      save: (value) => saveWindowPlacements(file, value),
      onWarning,
    });
  }

  static async load(file: string, options: WindowPlacementStoreOptions = {}): Promise<WindowPlacementStore> {
    return new WindowPlacementStore(
      file,
      await loadWindowPlacements(file),
      options.workAreas ?? screenWorkAreas,
      options.onWarning ?? (() => {}),
    );
  }

  frame(key: string, fallback: WindowFrame, minimum: WindowMinimumSize): WindowFrame {
    const stored = this.placements.frames[key];
    const logical = isWindowFrame(stored) ? stored : fallback;
    return visibleWindowFrame({
      x: logical.x,
      y: logical.y,
      width: scaledSize(Math.max(minimum.width, logical.width)),
      height: scaledSize(Math.max(minimum.height, logical.height)),
    }, this.workAreas(), {
      width: scaledSize(minimum.width),
      height: scaledSize(minimum.height),
    });
  }

  track(key: string, window: BrowserWindow): void {
    const capture = (frame: WindowFrame): void => {
      if (window.isMaximized()) return;
      this.remember(key, frame);
    };
    Electrobun.events.on(`move-${window.id}`, (event: { data: WindowFrame }) => capture(event.data));
    Electrobun.events.on(`resize-${window.id}`, (event: { data: WindowFrame }) => capture(event.data));
    window.on("close", () => {
      if (!window.isMaximized()) capture(window.getFrame());
    });
  }

  remember(key: string, frame: WindowFrame): void {
    this.placements.frames[key] = {
      x: Math.round(frame.x),
      y: Math.round(frame.y),
      width: unscaledSize(frame.width),
      height: unscaledSize(frame.height),
    };
    this.persistence.schedule(this.placements);
  }

  async flush(): Promise<void> {
    await this.persistence.flush();
  }
}

export function visibleScaledWindowFrame(
  logicalFrame: WindowFrame,
  minimum: WindowMinimumSize,
): WindowFrame {
  return visibleWindowFrame({
    x: logicalFrame.x,
    y: logicalFrame.y,
    width: scaledSize(Math.max(minimum.width, logicalFrame.width)),
    height: scaledSize(Math.max(minimum.height, logicalFrame.height)),
  }, screenWorkAreas(), {
    width: scaledSize(minimum.width),
    height: scaledSize(minimum.height),
  });
}

function screenWorkAreas(): readonly DisplayWorkArea[] {
  const primary = Screen.getPrimaryDisplay();
  return [
    primary.workArea,
    ...Screen.getAllDisplays()
      .filter((display) => display.id !== primary.id)
      .map((display) => display.workArea),
  ];
}

async function loadWindowPlacements(file: string): Promise<StoredPlacements> {
  try {
    const candidate = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (!candidate || typeof candidate !== "object") return structuredClone(EMPTY_PLACEMENTS);
    const source = (candidate as { frames?: unknown }).frames;
    if (!source || typeof source !== "object") return structuredClone(EMPTY_PLACEMENTS);
    const frames = Object.fromEntries(
      Object.entries(source).filter((entry): entry is [string, WindowFrame] => isWindowFrame(entry[1])),
    );
    return { frames };
  } catch {
    return structuredClone(EMPTY_PLACEMENTS);
  }
}

async function saveWindowPlacements(file: string, placements: StoredPlacements): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(placements, null, 2)}\n`, "utf8");
}
