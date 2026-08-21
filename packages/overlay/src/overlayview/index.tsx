import { batch, computed, signal, type Signal } from "@preact/signals";
import { render, type ComponentChildren } from "preact";
import { useCallback, useState } from "preact/hooks";
import { Electroview } from "electrobun/view";
import { formatDps, formatDuration } from "@svoverlay/ui-kit/format";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";
import { InteractiveChart } from "@svoverlay/ui-kit/interactive-chart";
import type { ChartRange, ChartRenderResult } from "@svoverlay/ui-kit/interactive-chart";
import { classIconUrlForArchetype, classIconUrlForName } from "@svoverlay/ui-kit/class-display";

import type { FishNetActiveStatus } from "@kar-mi/spirit-vale-tools-combat";
import {
  OVERLAY_ELEMENT_IDS,
  OVERLAY_ELEMENT_LABELS,
  type KeybindAction,
  type OverlayElementId,
  type OverlayElementSettings,
  type OverlayCharacterState,
  type OverlayControlState,
  type OverlayDisplayPlacement,
  type OverlayDragPreview,
  type OverlayLootToastEvent,
  type OverlayMeterPoint,
  type OverlayMeterState,
  type OverlayMinimapLootDrop,
  type OverlayMinimapState,
  type OverlayResource,
  type OverlayRpc,
  type OverlayStatusState,
  type PersonalDpsMode,
  type StatType,
} from "../app-types.ts";
import { displayForRect } from "../display-layout.ts";
import { resourceFill } from "../personal-resources.ts";
import { rarityColor, rarityLabel } from "../rarity.ts";
import { weightWarnLevel, type WeightWarnLevel } from "../weight-warning.ts";
import { ewmaSeries } from "@kar-mi/spirit-vale-tools-metrics";

/** World units mapped to the radar's edge, matched against a fraction of the tile's own size — the tile itself is user-resizable. */
const RADAR_WORLD_RADIUS = 60;
const RADAR_RING_COUNT = 3;
/** How long a loot notification card stays on screen before it's dropped from the queue. */
const LOOT_TOAST_LIFETIME_MS = 3_000;

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const MIN_ELEMENT_WIDTH = 160;
const MIN_ELEMENT_HEIGHT = 100;
const MIN_BAR_HEIGHT = 24;
const MIN_COMPACT_ELEMENT_HEIGHT = 40;
/** Buffs flash once they fall below this share of their own duration, if they last long enough. */
const FLASH_REMAINING_FRACTION = 0.15;
const FLASH_MINIMUM_DURATION_MS = 59_000;
/** How often the status countdowns are redrawn. Fine enough that the last second reads smoothly. */
const STATUS_TICK_MS = 100;
const GRID_SIZE = 10;
const RESIZE_EDGES = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
/** Pointer movement below this counts as selecting a tile rather than repositioning it. */
const CLICK_MOVE_THRESHOLD_PX = 4;
const PARTY_ROW_COLORS = [
  "rgba(111, 91, 211, 0.52)",
  "rgba(40, 132, 210, 0.52)",
  "rgba(27, 151, 135, 0.52)",
  "rgba(213, 130, 42, 0.52)",
  "rgba(193, 71, 139, 0.52)",
  "rgba(99, 153, 52, 0.52)",
  "rgba(190, 74, 69, 0.52)",
  "rgba(181, 151, 45, 0.52)",
] as const;
type ResizeEdge = (typeof RESIZE_EDGES)[number];
interface ElementRect { x: number; y: number; width: number; height: number }
type PointerGesture =
  | { kind: "drag"; pointerId: number; originX: number; originY: number; start: ElementRect }
  | { kind: "resize"; pointerId: number; originX: number; originY: number; start: ElementRect; edge: ResizeEdge };
/** The parts of the control state that affect the whole document rather than one tile. */
interface OverlayChrome {
  locked: boolean;
  meterStatType: StatType;
  personalDpsMode: PersonalDpsMode;
  shortcuts: Record<KeybindAction, string>;
  /** This window's own monitor, and every monitor, so a drag can be resolved across them. */
  surface?: OverlayDisplayPlacement;
  displayLayout: OverlayDisplayPlacement[];
}

// Control state is fanned out into one signal per tile plus one for the shared chrome, each
// updated only when its own slice actually changed. The control channel republishes whenever the
// capture status text moves — several times a second while reading a log — and without this split
// every one of those would re-render all fourteen tiles for data none of them read.
const chromeState = signal<OverlayChrome | undefined>(undefined);
const elementStates = Object.fromEntries(
  OVERLAY_ELEMENT_IDS.map((id) => [id, signal<OverlayElementSettings | undefined>(undefined)]),
) as Record<OverlayElementId, Signal<OverlayElementSettings | undefined>>;
const characterState = signal<OverlayCharacterState | undefined>(undefined);
/**
 * Warn level for the weight tile, derived apart from the raw state so the tile's chrome re-renders
 * only when a threshold is actually crossed, not on every character publish.
 */
const weightWarn = computed(() => weightWarnLevel(characterState.value?.weight));
const statusState = signal<OverlayStatusState | undefined>(undefined);
/**
 * Wall clock the status countdowns are drawn against.
 *
 * The overlay process publishes when the tracked set of statuses changes, not on a clock - a buff
 * that is merely running out produces no message at all until it lapses. Counting down here from
 * the `asOfMs` stamp on the last publish is what keeps the numbers moving, and it moves them more
 * smoothly than any publish cadence could.
 */
const statusNow = signal(Date.now());
/** Runs only while something is actually counting down; a screen of toggles needs no ticker. */
let statusTicker: ReturnType<typeof setInterval> | undefined;
const meterState = signal<OverlayMeterState | undefined>(undefined);
const minimapState = signal<OverlayMinimapState | undefined>(undefined);
interface LootToastCard { id: string; event: OverlayLootToastEvent }
const lootToasts = signal<LootToastCard[]>([]);
let lootToastSequence = 0;
function pushLootToast(event: OverlayLootToastEvent): void {
  const id = `${Date.now()}-${lootToastSequence++}`;
  lootToasts.value = [...lootToasts.value, { id, event }];
  setTimeout(() => {
    lootToasts.value = lootToasts.value.filter((card) => card.id !== id);
  }, LOOT_TOAST_LIFETIME_MS);
}
const gridEnabled = signal(false);
/** The unlocked tile whose controls are displayed in the inspector. */
const selectedElementId = signal<OverlayElementId | undefined>(undefined);
/** The inspector position is an edit-session convenience, not a saved overlay preference. */
const panelPosition = signal<{ x: number; y: number } | undefined>(undefined);
/** A tile being dragged on another monitor's surface, relayed here so it can be ghosted. */
const dragPreview = signal<OverlayDragPreview | undefined>(undefined);
let lastChromeJson: string | undefined;
const lastElementJson = new Map<OverlayElementId, string | undefined>();
/** Coalesces pointermove to one send per frame; a drag otherwise fires far above refresh rate. */
let pendingDragPreview: OverlayDragPreview | undefined;
let dragPreviewFrame = 0;

function sendDragPreview(preview: OverlayDragPreview): void {
  pendingDragPreview = preview;
  if (dragPreviewFrame) return;
  dragPreviewFrame = requestAnimationFrame(() => {
    dragPreviewFrame = 0;
    if (pendingDragPreview) electroview.rpc?.send.dragPreview(pendingDragPreview);
    pendingDragPreview = undefined;
  });
}

function endDragPreview(): void {
  if (dragPreviewFrame) cancelAnimationFrame(dragPreviewFrame);
  dragPreviewFrame = 0;
  pendingDragPreview = undefined;
  electroview.rpc?.send.dragPreviewEnded({});
}

function applyControl(next: OverlayControlState): void {
  batch(() => {
    const chrome: OverlayChrome = {
      locked: next.locked,
      meterStatType: next.meterStatType,
      personalDpsMode: next.personalDpsMode,
      shortcuts: next.shortcuts,
      surface: next.surface,
      displayLayout: next.displayLayout,
    };
    const chromeJson = JSON.stringify(chrome);
    if (chromeJson !== lastChromeJson) {
      lastChromeJson = chromeJson;
      chromeState.value = chrome;
    }
    for (const id of OVERLAY_ELEMENT_IDS) {
      // Absent means the tile lives on another monitor's surface, not that it is hidden.
      const element = next.elements[id];
      const json = element === undefined ? undefined : JSON.stringify(element);
      if (json === lastElementJson.get(id)) continue;
      lastElementJson.set(id, json);
      elementStates[id].value = element;
    }
  });
}

const rpc = Electroview.defineRPC<OverlayRpc>({
  handlers: { requests: {}, messages: {
    controlChanged: (next) => { applyControl(repairRendererPayload(next)); },
    characterChanged: (next) => { characterState.value = repairRendererPayload(next); },
    statusesChanged: (next) => { applyStatuses(repairRendererPayload(next)); },
    meterChanged: (next) => { meterState.value = repairRendererPayload(next); },
    // Numbers and an element id only, so it skips the mojibake repair every other channel pays.
    dragPreviewChanged: (next) => { dragPreview.value = next; },
    minimapChanged: (next) => { minimapState.value = repairRendererPayload(next); },
    lootDropped: (next) => { pushLootToast(repairRendererPayload(next)); },
  } },
});
const electroview = new Electroview({ rpc });
void electroview.rpc?.request.getState({}).then((next) => {
  const repaired = repairRendererPayload(next);
  batch(() => {
    applyControl(repaired.control);
    characterState.value = repaired.character;
    applyStatuses(repaired.statuses);
    meterState.value = repaired.meter;
    minimapState.value = repaired.minimap;
  });
});

/**
 * Adopts a status publish and starts or stops the countdown ticker to match it.
 *
 * Re-stamping `statusNow` here means the first frame after a publish is drawn against the moment the
 * state was measured, rather than against a reading up to one tick old.
 */
function applyStatuses(next: OverlayStatusState): void {
  statusState.value = next;
  statusNow.value = Date.now();
  const counting = [next.buffs, next.debuffs, next.toggles]
    .some((statuses) => statuses?.some((status) => status.remainingMs !== undefined));
  if (counting && statusTicker === undefined) {
    statusTicker = setInterval(() => { statusNow.value = Date.now(); }, STATUS_TICK_MS);
  } else if (!counting && statusTicker !== undefined) {
    clearInterval(statusTicker);
    statusTicker = undefined;
  }
}

function App() {
  const next = chromeState.value;
  if (!next) return <main class="overlay-root" />;
  return (
    <main class={next.locked ? "overlay-root" : "overlay-root editing"}>
      {!next.locked && <div class="edit-scrim" onPointerDown={() => { selectedElementId.value = undefined; }} />}
      {!next.locked && gridEnabled.value && <div class="grid-overlay" aria-hidden="true" />}
      {!next.locked && (
        <div class="edit-controls">
          <p class="edit-hint">
            {next.displayLayout.length > 1
              ? `Drag elements to arrange the overlay, or onto another screen to move them there. Press ${next.shortcuts.toggleLock} to lock or unlock.`
              : `Drag elements to arrange the overlay. Press ${next.shortcuts.toggleLock} to lock or unlock.`}
          </p>
          <div class="edit-buttons">
            <button
              class={gridEnabled.value ? "lock-pill grid-pill active" : "lock-pill grid-pill"}
              type="button"
              onClick={() => { gridEnabled.value = !gridEnabled.value; }}
            >
              {gridEnabled.value ? "Grid: On" : "Grid: Off"}
            </button>
            <button class="lock-pill" type="button" onClick={() => void setLocked(true)}>Lock overlay</button>
          </div>
        </div>
      )}
      {!next.locked && <ElementInspectorPanel selectedId={selectedElementId.value} />}
      <OverlayElement id="dpsChart" locked={next.locked}>
        <DpsChartElement />
      </OverlayElement>
      <OverlayElement id="personalDps" locked={next.locked}>
        <PersonalDpsElement />
      </OverlayElement>
      <OverlayElement id="health" locked={next.locked}>
        <CharacterResourceElement kind="health" />
      </OverlayElement>
      <OverlayElement id="mana" locked={next.locked}>
        <CharacterResourceElement kind="mana" />
      </OverlayElement>
      <OverlayElement id="characterXp" locked={next.locked}>
        <CharacterResourceElement kind="character-xp" />
      </OverlayElement>
      <OverlayElement id="jobXp" locked={next.locked}>
        <CharacterResourceElement kind="job-xp" />
      </OverlayElement>
      <WeightOverlayElement locked={next.locked} />
      <OverlayElement id="xpTracker" locked={next.locked}>
        <XpTrackerElement locked={next.locked} />
      </OverlayElement>
      <OverlayElement id="goldTracker" locked={next.locked}>
        <GoldTrackerElement locked={next.locked} />
      </OverlayElement>
      <OverlayElement id="xpChart" locked={next.locked}>
        <XpChartElement />
      </OverlayElement>
      <OverlayElement id="partyRanking" locked={next.locked}>
        <PartyRankingElement />
      </OverlayElement>
      <StatusOverlayElement id="buffs" locked={next.locked} category="buffs" flashExpiring />
      {/* Debuffs deliberately do not flash: one running out is good news. */}
      <StatusOverlayElement id="debuffs" locked={next.locked} category="debuffs" />
      <StatusOverlayElement id="toggles" locked={next.locked} category="toggles" />
      <OverlayElement id="minimap" locked={next.locked}>
        <MinimapElement />
      </OverlayElement>
      <OverlayElement id="lootToast" locked={next.locked}>
        <LootToastElement />
      </OverlayElement>
      {!next.locked && <DragGhost surface={next.surface} />}
    </main>
  );
}

/**
 * Stand-in for a tile currently being dragged on another monitor.
 *
 * Windows cannot paint past their own display, so without this the tile appears to stick to the
 * bezel until the mouse is released. Drawn at the same virtual-desktop position, mapped into this
 * surface's local coordinates.
 */
function DragGhost({ surface }: { surface?: OverlayDisplayPlacement }) {
  const preview = dragPreview.value;
  if (!preview || !surface || preview.origin === surface.display) return null;
  const x = preview.rect.x - surface.bounds.x;
  const y = preview.rect.y - surface.bounds.y;
  // Skip entirely while the tile is still far outside this monitor, so the ghost only shows up
  // once part of it would genuinely be on screen here.
  if (x + preview.rect.width < 0 || y + preview.rect.height < 0) return null;
  if (x > surface.bounds.width || y > surface.bounds.height) return null;
  return (
    <div
      class="drag-ghost"
      aria-hidden="true"
      style={{ left: `${x}px`, top: `${y}px`, width: `${preview.rect.width}px`, height: `${preview.rect.height}px` }}
    >
      <span>{OVERLAY_ELEMENT_LABELS[preview.id]}</span>
    </div>
  );
}

interface OverlayElementProps {
  id: OverlayElementId;
  locked: boolean;
  /** Outlines the tile in red, e.g. a status the user armed a missing-buff warning for is down. */
  warn?: boolean;
  /** Rings the weight tile as it nears maximum carry weight: steady caution, then flashing danger. */
  weightWarn?: WeightWarnLevel;
  children: ComponentChildren;
}

function StatusOverlayElement({
  id,
  locked,
  category,
  flashExpiring,
}: Omit<OverlayElementProps, "children" | "warn" | "weightWarn"> & {
  category: "buffs" | "debuffs" | "toggles";
  flashExpiring?: boolean;
}) {
  const next = statusState.value;
  const warn = category === "buffs" || category === "toggles"
    ? (next?.missingStatuses[category].length ?? 0) > 0
    : false;
  return (
    <OverlayElement id={id} locked={locked} warn={warn}>
      <StatusGridElement
        statuses={next?.[category]}
        asOfMs={next?.asOfMs}
        flashExpiring={flashExpiring}
      />
    </OverlayElement>
  );
}

function OverlayElement({ id, locked, warn, weightWarn, children }: OverlayElementProps) {
  const [gesture, setGesture] = useState<PointerGesture>();
  const [preview, setPreview] = useState<ElementRect>();
  // Read per tile rather than from a shared control object, so a change to one tile does not
  // re-render the other thirteen. Undefined means this tile lives on another monitor's surface.
  const settings = elementStates[id].value;
  if (!settings || (locked && !settings.enabled)) return null;
  const rect = preview ?? settings;
  // A disabled tile remains movable in edit mode, but its saved size is restored only when it is
  // enabled again; the placeholder itself stays deliberately compact.
  const displayRect = settings.enabled ? rect : { ...rect, width: 160, height: 36 };
  const selected = selectedElementId.value === id;
  const className = [
    "overlay-element",
    !settings.enabled && "hidden-preview",
    warn && settings.enabled && "missing-statuses",
    weightWarn && settings.enabled && `weight-${weightWarn}`,
    !locked && selected && "selected",
    gesture?.kind === "resize" ? "resizing" : gesture?.kind === "drag" ? "dragging" : undefined,
  ].filter(Boolean).join(" ");
  const move = (event: PointerEvent): void => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.originX;
    const dy = event.clientY - gesture.originY;
    const next = gesture.kind === "drag"
      ? dragRect(gesture.start, dx, dy)
      : resizeRect(gesture.start, gesture.edge, dx, dy, id);
    setPreview(next);
    // Only a drag can leave this monitor; a resize is clamped to the window either way.
    if (gesture.kind === "drag") relayDrag(id, next);
  };
  const finish = (event: PointerEvent): void => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.originX;
    const dy = event.clientY - gesture.originY;
    if (gesture.kind === "drag" && Math.hypot(dx, dy) < CLICK_MOVE_THRESHOLD_PX) {
      setGesture(undefined);
      setPreview(undefined);
      endDragPreview();
      selectedElementId.value = id;
      return;
    }
    const finalRect = gesture.kind === "drag"
      ? dragRect(gesture.start, dx, dy)
      : resizeRect(gesture.start, gesture.edge, dx, dy, id);
    const wasResize = gesture.kind === "resize";
    setGesture(undefined);
    setPreview(finalRect);
    if (!wasResize) selectedElementId.value = id;
    const request = wasResize
      ? electroview.rpc?.request.setElementBounds({ id, ...finalRect })
      : dropRequest(id, finalRect);
    if (!request) {
      if (!wasResize) endDragPreview();
      setPreview(undefined);
      return;
    }
    void request.then(
      (next) => {
        applyControl(next);
        // Retire the ghost only once the destination has been told about the tile, otherwise the
        // ghost clears a frame or two before the real tile arrives and the drop visibly blinks.
        if (!wasResize) endDragPreview();
        setPreview(undefined);
      },
      () => {
        // Restore the last authoritative position if the update could not be saved.
        if (!wasResize) endDragPreview();
        setPreview(undefined);
      },
    );
  };
  return (
    <section
      class={className}
      data-element-id={id}
      style={{
        left: `${displayRect.x}px`,
        top: `${displayRect.y}px`,
        width: `${displayRect.width}px`,
        height: `${displayRect.height}px`,
      }}
      onPointerDown={(event) => {
        if (locked || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const start = { x: settings.x, y: settings.y, width: settings.width, height: settings.height };
        setPreview(start);
        setGesture({ kind: "drag", pointerId: event.pointerId, originX: event.clientX, originY: event.clientY, start });
      }}
      onContextMenu={(event) => {
        if (locked) return;
        event.preventDefault();
        event.stopPropagation();
        void setElementEnabled(id, !settings.enabled);
      }}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={() => {
        endDragPreview();
        setGesture(undefined);
        setPreview(undefined);
      }}
    >
      {settings.enabled ? (
        <>
          <div class="overlay-surface" style={`--element-background-alpha:${settings.opacity * 0.76}`}>
            {children}
          </div>
          {!locked && <span class="element-title-badge">{OVERLAY_ELEMENT_LABELS[id]}</span>}
        </>
      ) : (
        <div class="disabled-element-placeholder">{OVERLAY_ELEMENT_LABELS[id]}</div>
      )}
      {!locked && settings.enabled && selected && RESIZE_EDGES.map((edge) => (
        <span
          key={edge}
          class={`resize-handle resize-${edge}`}
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            const start = { x: settings.x, y: settings.y, width: settings.width, height: settings.height };
            setPreview(start);
            setGesture({
              kind: "resize",
              pointerId: event.pointerId,
              originX: event.clientX,
              originY: event.clientY,
              start,
              edge,
            });
          }}
        />
      ))}
    </section>
  );
}

/**
 * A single inspector avoids the overlapping floating controls that result when tiles are placed
 * close together. It reads only the selected tile's signal, so edits to one tile remain isolated.
 */
function ElementInspectorPanel({ selectedId }: { selectedId: OverlayElementId | undefined }) {
  const [headerDrag, setHeaderDrag] = useState<{
    pointerId: number;
    originX: number;
    originY: number;
    start: { x: number; y: number };
  }>();
  const settings = selectedId ? elementStates[selectedId].value : undefined;
  if (!selectedId || !settings) return null;
  const position = panelPosition.value ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  return (
    <div
      class="element-inspector-panel"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        class={headerDrag ? "inspector-header dragging" : "inspector-header"}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setHeaderDrag({ pointerId: event.pointerId, originX: event.clientX, originY: event.clientY, start: position });
        }}
        onPointerMove={(event) => {
          if (!headerDrag || event.pointerId !== headerDrag.pointerId) return;
          panelPosition.value = {
            x: headerDrag.start.x + event.clientX - headerDrag.originX,
            y: headerDrag.start.y + event.clientY - headerDrag.originY,
          };
        }}
        onPointerUp={() => setHeaderDrag(undefined)}
        onPointerCancel={() => setHeaderDrag(undefined)}
      >
        <span>{OVERLAY_ELEMENT_LABELS[selectedId]}</span>
        <button
          type="button"
          class="inspector-close"
          aria-label="Close inspector"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => { selectedElementId.value = undefined; }}
        >
          ×
        </button>
      </div>
      <label class="inspector-row">
        <span>Tile opacity</span>
        <output>{Math.round(settings.opacity * 100)}%</output>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={settings.opacity}
          onInput={(event) => {
            const request = electroview.rpc?.request.setElementOpacity({
              id: selectedId,
              opacity: event.currentTarget.valueAsNumber,
            });
            void request?.then((next) => applyControl(next));
          }}
        />
      </label>
      <label class="inspector-row inspector-toggle">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={() => void setElementEnabled(selectedId, !settings.enabled)}
        />
        Visible
      </label>
    </div>
  );
}

/**
 * With more than one monitor a drag is deliberately not clamped to this window: pointer capture
 * keeps delivering moves once the cursor leaves the display, and letting the tile follow it off the
 * edge is what makes dropping it on the next screen possible. Where it actually lands is resolved
 * in `dropRequest`, and the bun side clamps it into whichever display that turns out to be.
 */
function dragRect(start: ElementRect, dx: number, dy: number): ElementRect {
  const spansDisplays = (chromeState.value?.displayLayout.length ?? 1) > 1;
  const x = spansDisplays
    ? Math.round(start.x + dx)
    : clamp(start.x + dx, 0, Math.max(0, window.innerWidth - start.width));
  const y = spansDisplays
    ? Math.round(start.y + dy)
    : clamp(start.y + dy, 0, Math.max(0, window.innerHeight - start.height));
  return {
    ...start,
    x: gridEnabled.value ? snapToGrid(x) : x,
    y: gridEnabled.value ? snapToGrid(y) : y,
  };
}

/** Publishes the in-flight drag in virtual-desktop coordinates so other surfaces can ghost it. */
function relayDrag(id: OverlayElementId, rect: ElementRect): void {
  const chrome = chromeState.value;
  if (!chrome?.surface || chrome.displayLayout.length < 2) return;
  const origin = chrome.surface.bounds;
  sendDragPreview({
    id,
    origin: chrome.surface.display,
    rect: { x: origin.x + rect.x, y: origin.y + rect.y, width: rect.width, height: rect.height },
  });
}

/**
 * Commits a finished drag, moving the tile to another monitor if that is where it was released.
 *
 * Tile coordinates are stored relative to their own display, so crossing a boundary means going
 * out to virtual-desktop coordinates via this surface's origin and back down against the target's.
 */
function dropRequest(id: OverlayElementId, rect: ElementRect): Promise<OverlayControlState> | undefined {
  const requests = electroview.rpc?.request;
  const chrome = chromeState.value;
  if (!requests) return undefined;
  if (!chrome?.surface || chrome.displayLayout.length < 2) {
    return requests.setElementPosition({ id, x: rect.x, y: rect.y });
  }
  const origin = chrome.surface.bounds;
  const dropped = { x: origin.x + rect.x, y: origin.y + rect.y, width: rect.width, height: rect.height };
  const target = displayForRect(chrome.displayLayout, dropped) ?? chrome.surface;
  if (target.display === chrome.surface.display) {
    return requests.setElementPosition({ id, x: rect.x, y: rect.y });
  }
  return requests.setElementPlacement({
    id,
    display: target.display,
    x: dropped.x - target.bounds.x,
    y: dropped.y - target.bounds.y,
  });
}

function resizeRect(start: ElementRect, edge: ResizeEdge, dx: number, dy: number, id: OverlayElementId): ElementRect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  const minimumHeight = id === "health" || id === "mana" || id === "characterXp" || id === "jobXp"
    ? MIN_BAR_HEIGHT
    : id === "weight" || id === "buffs" || id === "debuffs" || id === "toggles"
      ? MIN_COMPACT_ELEMENT_HEIGHT
      : MIN_ELEMENT_HEIGHT;
  if (edge.includes("w")) left = clamp(start.x + dx, 0, right - MIN_ELEMENT_WIDTH);
  if (edge.includes("e")) right = clamp(start.x + start.width + dx, left + MIN_ELEMENT_WIDTH, window.innerWidth);
  if (edge.includes("n")) top = clamp(start.y + dy, 0, bottom - minimumHeight);
  if (edge.includes("s")) bottom = clamp(start.y + start.height + dy, top + minimumHeight, window.innerHeight);
  if (gridEnabled.value) {
    left = snapToGrid(left);
    top = snapToGrid(top);
    right = snapToGrid(right);
    bottom = snapToGrid(bottom);
    if (right - left < MIN_ELEMENT_WIDTH) right = left + MIN_ELEMENT_WIDTH;
    if (bottom - top < minimumHeight) bottom = top + minimumHeight;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function meterMetricLabel(next: OverlayChrome): string {
  return next.meterStatType === "tanked" ? "TPS" : next.meterStatType === "heal" ? "HPS" : "DPS";
}

function DpsChartElement() {
  const meter = meterState.value;
  const control = chromeState.value!;
  const metricLabel = meterMetricLabel(control);
  const points = meter?.chart ?? [];
  const duration = meter?.chartDurationMs ?? 0;
  return (
    <div class="element-content">
      <h2 class="element-title">{meter?.personalChart ? `Personal ${metricLabel} over time` : `Map ${metricLabel} over time`}</h2>
      {points.length ? <DamageChart points={points} durationMs={duration} metricLabel={metricLabel} /> : <WaitingForDps />}
    </div>
  );
}

function DamageChart(
  { points, durationMs, metricLabel }: { points: readonly OverlayMeterPoint[]; durationMs: number; metricLabel: string },
) {
  const width = 640;
  const height = 220;
  const left = 42;
  const top = 12;
  const right = 12;
  const bottom = 26;
  const maxValue = Math.max(1, ...points.map((point) => point.dps));
  const duration = Math.max(1, durationMs);
  const linePoints = points.map((point) => {
    const x = left + (point.elapsedMs / duration) * (width - left - right);
    const y = top + (1 - point.dps / maxValue) * (height - top - bottom);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg class="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metricLabel} over time chart`}>
      <line class="chart-grid" x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} />
      <polyline class="chart-line" points={linePoints} />
      <text class="chart-label" x="0" y={top + 4}>{compactFormat.format(maxValue)}</text>
      <text class="chart-label" x={left} y={height - 5}>0:00</text>
      <text class="chart-label" text-anchor="end" x={width - right} y={height - 5}>{formatDuration(durationMs)}</text>
    </svg>
  );
}

function PersonalDpsElement() {
  const personal = meterState.value?.personal;
  const personalDpsMode = chromeState.value?.personalDpsMode;
  return (
    <div class="element-content">
      <div class="personal-heading">
        <img class="personal-class-icon" src={overlayClassIcon(personal?.archetype)} alt="" aria-hidden="true" />
        <div>
          <h2 class="element-title">{personalDpsMode === "live" ? "Live DPS" : "Encounter DPS"}</h2>
          {personalDpsMode !== "live" && <span class="personal-duration">{formatDuration(personal?.durationMs ?? 0)}</span>}
        </div>
      </div>
      {personal ? (
        <>
          <span class="personal-value">{formatDps(personal.currentDps)}</span><span class="personal-unit">DPS</span>
          <div class="personal-details">
            <span>Damage<strong>{compactFormat.format(personal.damage)}</strong></span>
            <span>Crit rate<strong>{personal.critRate === undefined ? "—" : `${Math.round(personal.critRate * 100)}%`}</strong></span>
          </div>
        </>
      ) : <WaitingForDps />}
    </div>
  );
}

/** The weight tile plus the ring around it that escalates as the character approaches maximum weight. */
function WeightOverlayElement({ locked }: { locked: boolean }) {
  return (
    <OverlayElement id="weight" locked={locked} weightWarn={weightWarn.value}>
      <WeightElement />
    </OverlayElement>
  );
}

function WeightElement() {
  const weight = characterState.value?.weight;
  return (
    <div class={`weight-value${weight ? "" : " weight-waiting"}`}>
      <strong class="weight-label">Weight</strong>
      {weight ? (
        <span class="weight-numbers" aria-label={`Weight ${weight.current} of ${weight.maximum}`}>
          <strong>{numberFormat.format(weight.current)}</strong>
          <span>/</span>
          <strong>{numberFormat.format(weight.maximum)}</strong>
        </span>
      ) : <span class="weight-empty">Waiting</span>}
    </div>
  );
}

function XpTrackerElement({ locked }: { locked: boolean }) {
  const xp = characterState.value?.xp;
  if (!xp) return <WaitingForDps label="Waiting for XP" />;
  return (
    <div class="element-content xp-tracker">
      <h2 class="element-title">Character XP</h2>
      <div class="xp-total"><small>Total</small>{compactFormat.format(xp.total)}</div>
      <div class="xp-rates">
        <span>{compactFormat.format(xp.perSecond)}<small>/s</small></span>
        <span>{compactFormat.format(xp.perHour)}<small>/hr</small></span>
      </div>
      {!locked && (
        <button
          class="xp-reset-button"
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            void electroview.rpc?.request.resetXpTracker({}).then((nextState) => { characterState.value = nextState; });
          }}
        >
          Reset
        </button>
      )}
    </div>
  );
}

function GoldTrackerElement({ locked }: { locked: boolean }) {
  const gold = characterState.value?.gold;
  if (!gold) return <WaitingForDps label="Waiting for gold" />;
  return (
    <div class="element-content gold-tracker">
      <h2 class="element-title">Gold dropped</h2>
      <div class="gold-total"><small>Total</small>{compactFormat.format(gold.total)}</div>
      <div class="gold-rates">
        <span>{compactFormat.format(gold.perSecond)}<small>/s</small></span>
        <span>{compactFormat.format(gold.perHour)}<small>/hr</small></span>
      </div>
      {!locked && (
        <button
          class="gold-reset-button"
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            void electroview.rpc?.request.resetGoldTracker({}).then((nextState) => { characterState.value = nextState; });
          }}
        >
          Reset
        </button>
      )}
    </div>
  );
}

function XpChartElement() {
  const buckets = characterState.value?.xp.timeline ?? [];
  const rangeEnd = Date.now();
  const rollingRange = { start: rangeEnd - 10 * 60_000, end: rangeEnd };
  const computeRender = useCallback((range: ChartRange, _width: number): ChartRenderResult => {
    const rates = ewmaSeries(buckets, range);
    const maximum = rates.reduce((highest, point) => Math.max(highest, point.value), 0);
    return {
      points: rates.map((point) => ({
        time: point.time,
        ratio: maximum > 0 ? point.value / maximum : 0,
        primary: `${compactFormat.format(point.value)}/sec`,
        secondary: "20-second EWMA",
      })),
      yLabels: Array.from({ length: 5 }, (_, tick) => compactFormat.format((maximum * tick) / 4)),
    };
  }, [buckets]);

  return (
    <div class="element-content xp-chart">
      <h2 class="element-title">Character XP over time</h2>
      <InteractiveChart
        extent={rollingRange}
        computeRender={computeRender}
        stepped={false}
        emptyLabel="Waiting for XP"
        ariaLabel="Character XP rate over time"
        resetKey="xp-chart"
        interactive={false}
        xAxisTickCount={2}
      />
    </div>
  );
}

type ResourceKind = "health" | "mana" | "character-xp" | "job-xp";

function ResourceElement({ kind, resource }: { kind: ResourceKind; resource: OverlayResource | undefined }) {
  const label = kind === "health" ? "HP"
    : kind === "mana" ? "MP"
    : kind === "character-xp" ? "XP"
    : "JOB XP";
  const description = resource
    ? `${label} ${resource.current} of ${resource.maximum}`
    : `Waiting for ${label}`;
  return (
    <div
      class={`resource-value resource-${kind}${resource ? "" : " resource-waiting"}`}
      style={`--resource-fill:${resource ? resourceFill(resource) : 0}`}
      aria-label={description}
    >
      <strong class="resource-label">{label}</strong>
      {resource ? (
        <span class="resource-numbers">
          <strong>{numberFormat.format(resource.current)}</strong>
          <span>/</span>
          <strong>{numberFormat.format(resource.maximum)}</strong>
        </span>
      ) : <span class="resource-empty">Waiting</span>}
    </div>
  );
}

function CharacterResourceElement({ kind }: { kind: ResourceKind }) {
  const next = characterState.value;
  const resource = kind === "health" ? next?.health
    : kind === "mana" ? next?.mana
    : kind === "character-xp" ? next?.characterXp
    : next?.jobXp;
  return <ResourceElement kind={kind} resource={resource} />;
}

function PartyRankingElement() {
  const meter = meterState.value;
  const control = chromeState.value!;
  const metricLabel = meterMetricLabel(control);
  const actors = meter?.party ?? [];
  const maxDps = Math.max(1, ...actors.map((actor) => actor.dps));
  const duration = meter?.partyDurationMs ?? 0;
  return (
    <div class="element-content">
      <div class="party-heading">
        <div>
          <h2 class="element-title">Map encounter {metricLabel}</h2>
          <span class="party-duration">{formatDuration(duration)}</span>
        </div>
        <span class="party-reset-hint">{control.shortcuts.resetSession} to reset · {control.shortcuts.cycleMeterStatType} to switch</span>
      </div>
      {actors.length ? <div class="ranking">{actors.map((actor, index) => (
        <div
          class="ranking-row"
          key={actor.actorId}
          style={`--row-fill:${actor.dps / maxDps * 100}%;--row-color:${PARTY_ROW_COLORS[index % PARTY_ROW_COLORS.length]}`}
        >
          <span class="ranking-player">
            <img class="ranking-class-icon" src={overlayClassIcon(actor.archetype)} alt="" aria-hidden="true" />
            <span class="ranking-rank">{index + 1}.</span>
            <span class="ranking-name">{actor.displayName}</span>
          </span>
          <span class="ranking-dps">{formatDps(actor.dps)}</span>
        </div>
      ))}</div> : <WaitingForDps />}
    </div>
  );
}

function StatusGridElement(
  { statuses, asOfMs, flashExpiring }: {
    statuses: FishNetActiveStatus[] | undefined;
    asOfMs: number | undefined;
    flashExpiring?: boolean;
  },
) {
  const list = statuses ?? [];
  if (list.length === 0) {
    return (
      <div class="status-grid-empty">
        <span>None active</span>
      </div>
    );
  }
  return (
    <div class="status-grid">
      {list.map((status) => (
        <StatusCell
          key={status.statusId}
          status={status}
          asOfMs={asOfMs}
          flashExpiring={flashExpiring}
        />
      ))}
    </div>
  );
}

function StatusCell(
  { status, asOfMs, flashExpiring }: {
    status: FishNetActiveStatus;
    asOfMs: number | undefined;
    flashExpiring?: boolean;
  },
) {
  // A sprite id no longer guarantees the artwork shipped: summons resolve theirs from the skill
  // catalog, which covers far more skills than the icons copied into views/assets/status-icons.
  // Drop the cell rather than leaving an empty frame behind, matching how icon-less statuses are
  // already filtered out upstream.
  const [iconMissing, setIconMissing] = useState(false);
  if (iconMissing) return null;
  const totalMs = status.expiresAtMs === undefined ? undefined : status.expiresAtMs - status.appliedAtMs;
  // The published figure was measured when the state was projected; carry it forward to now rather
  // than waiting for a message that only arrives once the buff is gone.
  const remainingMs = status.remainingMs === undefined || asOfMs === undefined
    ? status.remainingMs
    : Math.max(0, status.remainingMs - Math.max(0, statusNow.value - asOfMs));
  const remainingFraction = totalMs !== undefined && totalMs > 0 && remainingMs !== undefined
    ? Math.max(0, Math.min(1, remainingMs / totalMs))
    : undefined;
  // Short buffs spend their whole life near the threshold, so flashing them would be constant
  // noise; only buffs long enough for the last 15% to be a usable warning pulse.
  const expiring = flashExpiring
    && totalMs !== undefined && totalMs > FLASH_MINIMUM_DURATION_MS
    && remainingFraction !== undefined && remainingFraction <= FLASH_REMAINING_FRACTION;
  return (
    <div class={expiring ? "status-cell expiring" : "status-cell"} title={status.displayName}>
      <div
        class="status-icon-frame"
        style={remainingFraction === undefined ? undefined : `--status-remaining:${Math.round(remainingFraction * 100)}%`}
      >
        <img
          class="status-icon"
          src={statusIcon(status.spriteId)}
          alt=""
          aria-hidden="true"
          onError={() => setIconMissing(true)}
        />
        {remainingFraction !== undefined && <span class="status-timer-fill" aria-hidden="true" />}
        {status.stacks !== undefined && status.stacks > 1 && <span class="status-stacks">{status.stacks}</span>}
      </div>
      {remainingMs !== undefined && <span class="status-remaining">{formatRemaining(remainingMs)}</span>}
    </div>
  );
}

function statusIcon(spriteId: string | undefined): string {
  return spriteId ? `views://assets/status-icons/${spriteId}.webp` : "";
}

function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / 1_000);
  if (totalSeconds >= 60) return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
  return `${totalSeconds}`;
}

interface RadarDot extends OverlayMinimapLootDrop {
  /** Fraction of the radar's radius, -1..1 on each axis, so the dot lays out relative to the tile's own (user-resizable) size. */
  fx: number;
  fy: number;
}

const minimapDots = computed<RadarDot[]>(() => {
  const state = minimapState.value;
  const player = state?.player;
  if (!player) return [];
  return state.loot
    .filter((drop) => (drop.rarity ?? 0) >= state.rarityFilter)
    .flatMap((drop) => {
      const dx = drop.x - player.x;
      // The game's world-space x axis maps to the radar's vertical (N/S) axis (inverted), and z maps to horizontal (E/W, inverted).
      const dz = drop.z - player.z;
      const fx = -dz / RADAR_WORLD_RADIUS;
      const fy = -dx / RADAR_WORLD_RADIUS;
      if (Math.hypot(fx, fy) > 1) return [];
      return [{ ...drop, fx, fy }];
    });
});

function MinimapElement() {
  const state = minimapState.value;
  return (
    <div class="minimap-radar">
      <MinimapRangeRings />
      <div class="minimap-crosshair horizontal" />
      <div class="minimap-crosshair vertical" />
      <span class="minimap-compass north">N</span>
      <span class="minimap-compass south">S</span>
      <span class="minimap-compass east">E</span>
      <span class="minimap-compass west">W</span>
      {state?.player ? (
        <>
          <span
            class="minimap-player"
            style={state.player.heading === undefined
              ? undefined
              : { transform: `translate(-50%, -50%) rotate(${state.player.heading * (180 / Math.PI) - 90}deg)` }}
          />
          {minimapDots.value.map((dot) => <MinimapLootDot key={dot.objectId} dot={dot} />)}
        </>
      ) : <span class="minimap-empty">Waiting for position</span>}
    </div>
  );
}

function MinimapRangeRings() {
  return <>{Array.from({ length: RADAR_RING_COUNT }, (_, index) => {
    const percent = ((index + 1) / RADAR_RING_COUNT) * 100;
    return <span key={index} class="minimap-ring" style={{ width: `${percent}%`, height: `${percent}%`, left: "50%", top: "50%" }} />;
  })}</>;
}

function MinimapLootDot({ dot }: { dot: RadarDot }) {
  const color = rarityColor(dot.rarity);
  return (
    <span
      class="minimap-dot"
      style={{
        left: `calc(50% + ${dot.fx * 50}%)`,
        top: `calc(50% + ${dot.fy * 50}%)`,
        backgroundColor: color,
        "--dot-color": color,
      }}
      title={`${dot.displayName ?? "Loot"} (${rarityLabel(dot.rarity)})`}
    />
  );
}

function LootToastElement() {
  const cards = lootToasts.value;
  return (
    <div class="loot-toast-stack">
      {cards.map((card) => <LootToastCard key={card.id} event={card.event} />)}
    </div>
  );
}

function LootToastCard({ event }: { event: OverlayLootToastEvent }) {
  const color = rarityColor(event.rarity);
  return (
    <div class="loot-toast-card" style={{ "--rarity-color": color }}>
      <span class="loot-toast-name">{event.displayName ?? "Loot"}</span>
      <span class="loot-toast-rarity">{rarityLabel(event.rarity)}</span>
    </div>
  );
}

function WaitingForDps({ label = "Waiting for DPS" }: { label?: string } = {}) {
  const toggleLockShortcut = chromeState.value?.shortcuts.toggleLock;
  return (
    <div class="empty">
      <span>{label}</span>
      <span class="empty-help">{toggleLockShortcut
        ? `Press ${toggleLockShortcut} to toggle edit mode, or open Settings from any app window`
        : "Open Settings from any app window to toggle edit mode"}</span>
    </div>
  );
}

function overlayClassIcon(archetype: number | undefined): string {
  return classIconUrlForArchetype(archetype) ?? classIconUrlForName("Weaver")!;
}

function setLocked(locked: boolean): Promise<void> {
  return electroview.rpc?.request.setLocked({ locked }).then((next) => applyControl(next)) ?? Promise.resolve();
}

function setElementEnabled(id: OverlayElementId, enabled: boolean): Promise<void> {
  return electroview.rpc?.request.setElementEnabled({ id, enabled }).then((next) => applyControl(next)) ?? Promise.resolve();
}


render(<App />, document.getElementById("root")!);
