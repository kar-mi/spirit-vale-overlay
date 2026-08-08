/* Webview-side chrome for frameless windows: JS titlebar drag and 8-handle
   edge/corner resizing via rAF-throttled setFrame calls.
   Ported from the proven setup in ffxiv_gear_setup/src/ui/window/resize.ts.
   Requires the .resize-handle rules from theme.css. */

export interface WindowFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowChromeOptions {
  /** Drag surface. pointerdowns on buttons/inputs inside it are ignored. */
  titlebar: HTMLElement;
  minWidth: number;
  minHeight: number;
  getFrame(): Promise<WindowFrame>;
  setFrame(frame: WindowFrame): unknown;
  /** Toggle maximize in the backend; resolves to the new maximized state.
      Omit for windows that must not maximize (e.g. the DPS overlay). */
  toggleMaximize?(): Promise<boolean>;
  /** Called whenever the maximized state changes (update button glyphs here). */
  onMaximizedChange?(maximized: boolean): void;
}

export interface WindowChrome {
  toggleMaximize(): Promise<void>;
  isMaximized(): boolean;
}

type Edge = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const EDGES: readonly Edge[] = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];

export function initWindowChrome(options: WindowChromeOptions): WindowChrome {
  let maximized = false;
  const handleHost = options.titlebar.parentElement ?? document.body;

  const handles = EDGES.map((edge) => {
    const handle = document.createElement("div");
    handle.className = edge.length === 1
      ? `resize-handle resize-edge-${edge}`
      : `resize-handle resize-corner resize-corner-${edge}`;
    handle.addEventListener("pointerdown", (event) => startResize(edge, event));
    handleHost.append(handle);
    return handle;
  });

  options.titlebar.addEventListener("pointerdown", startMove);
  options.titlebar.addEventListener("dblclick", (event) => {
    if ((event.target as HTMLElement).closest("button, input, select, a")) return;
    void toggleMaximize();
  });

  async function toggleMaximize(): Promise<void> {
    if (!options.toggleMaximize) return;
    setMaximized(await options.toggleMaximize());
  }

  function setMaximized(next: boolean): void {
    if (next === maximized) return;
    maximized = next;
    for (const handle of handles) handle.hidden = maximized;
    options.onMaximizedChange?.(maximized);
  }

  function startMove(event: PointerEvent): void {
    if (maximized) return;
    if ((event.target as HTMLElement).closest("button, input, select, a")) return;
    trackPointer(event, (frame, dx, dy) => ({ ...frame, x: frame.x + dx, y: frame.y + dy }));
  }

  function startResize(edge: Edge, event: PointerEvent): void {
    if (maximized) return;
    trackPointer(event, (frame, dx, dy, scale) => {
      let { x, y, width, height } = frame;
      const minWidth = options.minWidth * scale;
      const minHeight = options.minHeight * scale;
      if (edge.includes("e")) width = Math.max(minWidth, width + dx);
      if (edge.includes("s")) height = Math.max(minHeight, height + dy);
      if (edge.includes("w")) {
        const newWidth = Math.max(minWidth, width - dx);
        x += width - newWidth;
        width = newWidth;
      }
      if (edge.includes("n")) {
        const newHeight = Math.max(minHeight, height - dy);
        y += height - newHeight;
        height = newHeight;
      }
      return { x, y, width, height };
    });
  }

  /** Pointer-capture + rAF-throttled setFrame from screen-space deltas. */
  function trackPointer(
    event: PointerEvent,
    apply: (initial: WindowFrame, dx: number, dy: number, scale: number) => WindowFrame,
  ): void {
    const el = event.currentTarget as HTMLElement;
    el.setPointerCapture(event.pointerId);

    const startX = event.screenX;
    const startY = event.screenY;
    let initialFrame: WindowFrame | null = null;
    let rafScheduled = false;
    let lastScreenX = startX;
    let lastScreenY = startY;

    void options.getFrame().then((frame) => { initialFrame = frame; });

    function onPointerMove(move: PointerEvent): void {
      if (!initialFrame) return;
      lastScreenX = move.screenX;
      lastScreenY = move.screenY;
      if (rafScheduled) return;
      rafScheduled = true;
      requestAnimationFrame(() => {
        rafScheduled = false;
        if (!initialFrame) return;
        const scale = window.devicePixelRatio || 1;
        void options.setFrame(apply(
          initialFrame,
          (lastScreenX - startX) * scale,
          (lastScreenY - startY) * scale,
          scale,
        ));
      });
    }

    function cleanup(): void {
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", cleanup);
      el.removeEventListener("pointercancel", cleanup);
    }

    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", cleanup);
    el.addEventListener("pointercancel", cleanup);
  }

  return { toggleMaximize, isMaximized: () => maximized };
}
