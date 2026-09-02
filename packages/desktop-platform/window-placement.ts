import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { BrowserWindow, Screen } from "@svoverlay/desktop-runtime";

import { SafeSaveQueue } from "./safe-save.ts";
import { scaledSize, unscaledSize } from "./ui-scale-window.ts";
import { DisposableStore, onWindowEvent, onceWindowEvent, type Dispose } from "./window-lifecycle.ts";
import type { WindowFrame } from "@svoverlay/ui-kit/window-chrome";
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

  /** Whether a placement was saved, so first-run windows can be left where the OS puts them. */
  has(key: string): boolean {
    return isWindowFrame(this.placements.frames[key]);
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

  track(key: string, window: BrowserWindow): Dispose {
    const lifecycle = new DisposableStore();
    const capture = (frame: WindowFrame): void => {
      if (window.isMaximized()) return;
      this.remember(key, frame);
    };
    lifecycle.add(onWindowEvent(window, "move", (event: { data: WindowFrame }) => capture(event.data)));
    lifecycle.add(onWindowEvent(window, "resize", (event: { data: WindowFrame }) => capture(event.data)));
    lifecycle.add(onceWindowEvent(window, "close", () => {
      if (!window.isMaximized()) capture(window.getFrame());
      lifecycle.dispose();
    }));
    return () => lifecycle.dispose();
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

export interface FrameClamp {
  /** Raise a logical frame's width/height to the minimum. */
  clamp(frame: WindowFrame): WindowFrame;
  /** Unscale a physical frame, then clamp — the form to persist. */
  unscale(frame: WindowFrame): WindowFrame;
  /** Raise a physical frame's width/height to the scaled minimum. */
  clampPhysical(frame: WindowFrame): WindowFrame;
}

export function frameClamp(minWidth: number, minHeight: number): FrameClamp {
  const clamp = (frame: WindowFrame): WindowFrame => ({
    x: frame.x,
    y: frame.y,
    width: Math.max(minWidth, frame.width),
    height: Math.max(minHeight, frame.height),
  });
  return {
    clamp,
    unscale: (frame) => clamp({ x: frame.x, y: frame.y, width: unscaledSize(frame.width), height: unscaledSize(frame.height) }),
    clampPhysical: (frame) => ({
      x: frame.x,
      y: frame.y,
      width: Math.max(scaledSize(minWidth), frame.width),
      height: Math.max(scaledSize(minHeight), frame.height),
    }),
  };
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

export async function importWindowPlacements(oldFile: string, newFile: string): Promise<void> {
  await saveWindowPlacements(newFile, await loadWindowPlacements(oldFile));
}

export async function resetWindowPlacements(file: string): Promise<void> {
  await saveWindowPlacements(file, structuredClone(EMPTY_PLACEMENTS));
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
