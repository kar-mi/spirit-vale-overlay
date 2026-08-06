import { batch, signal } from "@preact/signals";
import { render, type ComponentChildren } from "preact";
import { useCallback, useState } from "preact/hooks";
import { Electroview } from "electrobun/view";
import { formatDps, formatDuration } from "@spiritvale/ui-core/format";
import { repairRendererPayload } from "@spiritvale/ui-core/renderer-text";
import { InteractiveChart } from "@spiritvale/ui-core/interactive-chart";
import type { ChartRange, ChartRenderResult } from "@spiritvale/ui-core/interactive-chart";

import type { FishNetActiveStatus } from "@kar-mi/spirit-vale-tools-combat";
import {
  OVERLAY_ELEMENT_LABELS,
  type OverlayElementId,
  type OverlayElementSettings,
  type OverlayCharacterState,
  type OverlayControlState,
  type OverlayMeterPoint,
  type OverlayMeterState,
  type OverlayResource,
  type OverlayRpc,
  type OverlayStatusState,
} from "../app-types.ts";
import { resourceFill } from "../personal-resources.ts";
import { buildXpEwmaTrend } from "./xp-ewma-trend.ts";

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const MIN_ELEMENT_WIDTH = 160;
const MIN_ELEMENT_HEIGHT = 100;
const MIN_BAR_HEIGHT = 24;
const MIN_COMPACT_ELEMENT_HEIGHT = 40;
/** Buffs flash once they fall below this share of their own duration, if they last long enough. */
const FLASH_REMAINING_FRACTION = 0.15;
const FLASH_MINIMUM_DURATION_MS = 59_000;
const GRID_SIZE = 10;
const RESIZE_EDGES = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
const CLASS_ICON_BY_ARCHETYPE: Readonly<Record<number, string>> = {
  0: "warrior",
  1: "mage",
  2: "rogue",
  3: "knight",
  4: "summoner",
  5: "acolyte",
  6: "scout",
  10: "paladin",
  12: "berserker",
  14: "priest",
  16: "wizard",
  21: "shinobi",
  22: "gunslinger",
  26: "necromancer",
  31: "weaver",
};
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
const controlState = signal<OverlayControlState | undefined>(undefined);
const characterState = signal<OverlayCharacterState | undefined>(undefined);
const statusState = signal<OverlayStatusState | undefined>(undefined);
const meterState = signal<OverlayMeterState | undefined>(undefined);
const gridEnabled = signal(false);

const rpc = Electroview.defineRPC<OverlayRpc>({
  handlers: { requests: {}, messages: {
    controlChanged: (next) => { controlState.value = repairRendererPayload(next); },
    characterChanged: (next) => { characterState.value = repairRendererPayload(next); },
    statusesChanged: (next) => { statusState.value = repairRendererPayload(next); },
    meterChanged: (next) => { meterState.value = repairRendererPayload(next); },
  } },
});
const electroview = new Electroview({ rpc });
void electroview.rpc?.request.getState({}).then((next) => {
  const repaired = repairRendererPayload(next);
  batch(() => {
    controlState.value = repaired.control;
    characterState.value = repaired.character;
    statusState.value = repaired.statuses;
    meterState.value = repaired.meter;
  });
});

function App() {
  const next = controlState.value;
  if (!next) return <main class="overlay-root" />;
  return (
    <main class={next.locked ? "overlay-root" : "overlay-root editing"}>
      {!next.locked && <div class="edit-scrim" />}
      {!next.locked && gridEnabled.value && <div class="grid-overlay" aria-hidden="true" />}
      {!next.locked && (
        <div class="edit-controls">
          <p class="edit-hint">Drag elements to arrange the overlay. Press F11 to lock or unlock.</p>
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
      <OverlayElement id="dpsChart" settings={next.elements.dpsChart} locked={next.locked}>
        <DpsChartElement />
      </OverlayElement>
      <OverlayElement id="personalDps" settings={next.elements.personalDps} locked={next.locked}>
        <PersonalDpsElement />
      </OverlayElement>
      <OverlayElement id="health" settings={next.elements.health} locked={next.locked}>
        <CharacterResourceElement kind="health" />
      </OverlayElement>
      <OverlayElement id="mana" settings={next.elements.mana} locked={next.locked}>
        <CharacterResourceElement kind="mana" />
      </OverlayElement>
      <OverlayElement id="characterXp" settings={next.elements.characterXp} locked={next.locked}>
        <CharacterResourceElement kind="character-xp" />
      </OverlayElement>
      <OverlayElement id="jobXp" settings={next.elements.jobXp} locked={next.locked}>
        <CharacterResourceElement kind="job-xp" />
      </OverlayElement>
      <OverlayElement id="weight" settings={next.elements.weight} locked={next.locked}>
        <WeightElement />
      </OverlayElement>
      <OverlayElement id="xpTracker" settings={next.elements.xpTracker} locked={next.locked}>
        <XpTrackerElement locked={next.locked} />
      </OverlayElement>
      <OverlayElement id="goldTracker" settings={next.elements.goldTracker} locked={next.locked}>
        <GoldTrackerElement locked={next.locked} />
      </OverlayElement>
      <OverlayElement id="xpChart" settings={next.elements.xpChart} locked={next.locked}>
        <XpChartElement />
      </OverlayElement>
      <OverlayElement id="partyRanking" settings={next.elements.partyRanking} locked={next.locked}>
        <PartyRankingElement />
      </OverlayElement>
      <StatusOverlayElement
        id="buffs"
        settings={next.elements.buffs}
        locked={next.locked}
        category="buffs"
        flashExpiring
      />
      {/* Debuffs deliberately do not flash: one running out is good news. */}
      <StatusOverlayElement id="debuffs" settings={next.elements.debuffs} locked={next.locked} category="debuffs" />
      <StatusOverlayElement
        id="toggles"
        settings={next.elements.toggles}
        locked={next.locked}
        category="toggles"
      />
    </main>
  );
}

interface OverlayElementProps {
  id: OverlayElementId;
  settings: OverlayElementSettings;
  locked: boolean;
  /** Outlines the tile in red, e.g. a status the user armed a missing-buff warning for is down. */
  warn?: boolean;
  children: ComponentChildren;
}

function StatusOverlayElement({
  id,
  settings,
  locked,
  category,
  flashExpiring,
}: Omit<OverlayElementProps, "children" | "warn"> & {
  category: "buffs" | "debuffs" | "toggles";
  flashExpiring?: boolean;
}) {
  const next = statusState.value;
  const warn = category === "buffs" || category === "toggles"
    ? (next?.missingStatuses[category].length ?? 0) > 0
    : false;
  return (
    <OverlayElement id={id} settings={settings} locked={locked} warn={warn}>
      <StatusGridElement statuses={next?.[category]} flashExpiring={flashExpiring} />
    </OverlayElement>
  );
}

function OverlayElement({ id, settings, locked, warn, children }: OverlayElementProps) {
  const [gesture, setGesture] = useState<PointerGesture>();
  const [preview, setPreview] = useState<ElementRect>();
  if (locked && !settings.enabled) return null;
  const rect = preview ?? settings;
  const className = [
    "overlay-element",
    !settings.enabled && "hidden-preview",
    warn && settings.enabled && "missing-statuses",
    gesture?.kind === "resize" ? "resizing" : gesture?.kind === "drag" ? "dragging" : undefined,
  ].filter(Boolean).join(" ");
  const move = (event: PointerEvent): void => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.originX;
    const dy = event.clientY - gesture.originY;
    setPreview(gesture.kind === "drag"
      ? dragRect(gesture.start, dx, dy)
      : resizeRect(gesture.start, gesture.edge, dx, dy, id));
  };
  const finish = (event: PointerEvent): void => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.originX;
    const dy = event.clientY - gesture.originY;
    const finalRect = gesture.kind === "drag"
      ? dragRect(gesture.start, dx, dy)
      : resizeRect(gesture.start, gesture.edge, dx, dy, id);
    const wasResize = gesture.kind === "resize";
    setGesture(undefined);
    setPreview(finalRect);
    const request = wasResize
      ? electroview.rpc?.request.setElementBounds({ id, ...finalRect })
      : electroview.rpc?.request.setElementPosition({ id, x: finalRect.x, y: finalRect.y });
    if (!request) {
      setPreview(undefined);
      return;
    }
    void request.then(
      (next) => {
        controlState.value = next;
        setPreview(undefined);
      },
      () => {
        // Restore the last authoritative position if the update could not be saved.
        setPreview(undefined);
      },
    );
  };
  return (
    <section
      class={className}
      data-element-id={id}
      style={{
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
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
        setGesture(undefined);
        setPreview(undefined);
      }}
    >
      <div class="overlay-surface" style={`--element-background-alpha:${settings.opacity * 0.76}`}>
        {children}
      </div>
      {!locked && !settings.enabled && <span class="hidden-indicator">Hidden</span>}
      {!locked && <span class="element-title-badge">{OVERLAY_ELEMENT_LABELS[id]}</span>}
      {!locked && (
        <label
          class="element-opacity-control"
          onPointerDown={(event) => event.stopPropagation()}
        >
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
                id,
                opacity: event.currentTarget.valueAsNumber,
              });
              void request?.then((next) => { controlState.value = next; });
            }}
          />
        </label>
      )}
      {!locked && RESIZE_EDGES.map((edge) => (
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

function dragRect(start: ElementRect, dx: number, dy: number): ElementRect {
  const x = clamp(start.x + dx, 0, Math.max(0, window.innerWidth - start.width));
  const y = clamp(start.y + dy, 0, Math.max(0, window.innerHeight - start.height));
  return {
    ...start,
    x: gridEnabled.value ? snapToGrid(x) : x,
    y: gridEnabled.value ? snapToGrid(y) : y,
  };
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

function meterMetricLabel(next: OverlayControlState): string {
  return next.meterStatType === "tanked" ? "TPS" : next.meterStatType === "heal" ? "HPS" : "DPS";
}

function DpsChartElement() {
  const meter = meterState.value;
  const control = controlState.value!;
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
  return (
    <div class="element-content">
      <div class="personal-heading">
        <img class="personal-class-icon" src={classIcon(personal?.archetype)} alt="" aria-hidden="true" />
        <h2 class="element-title">Rolling 5s DPS</h2>
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
      <div class="xp-total"><small>Total</small>{compactFormat.format(xp.totalExperience)}</div>
      <div class="xp-rates">
        <span>{compactFormat.format(xp.xpPerSecond)}<small>/s</small></span>
        <span>{compactFormat.format(xp.xpPerHour)}<small>/hr</small></span>
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
      <div class="gold-total"><small>Total</small>{compactFormat.format(gold.totalCoins)}</div>
      <div class="gold-rates">
        <span>{compactFormat.format(gold.coinsPerSecond)}<small>/s</small></span>
        <span>{compactFormat.format(gold.coinsPerHour)}<small>/hr</small></span>
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
    const rates = buildXpEwmaTrend(buckets, range);
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
      style={`--resource-fill:${resource ? resourceFill(resource) : 0}%`}
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
  const control = controlState.value!;
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
            <img class="ranking-class-icon" src={classIcon(actor.archetype)} alt="" aria-hidden="true" />
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
  { statuses, flashExpiring }: { statuses: FishNetActiveStatus[] | undefined; flashExpiring?: boolean },
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
      {list.map((status) =>
        <StatusCell key={status.statusId} status={status} flashExpiring={flashExpiring} />)}
    </div>
  );
}

function StatusCell(
  { status, flashExpiring }: { status: FishNetActiveStatus; flashExpiring?: boolean },
) {
  // A sprite id no longer guarantees the artwork shipped: summons resolve theirs from the skill
  // catalog, which covers far more skills than the icons copied into views/assets/status-icons.
  // Drop the cell rather than leaving an empty frame behind, matching how icon-less statuses are
  // already filtered out upstream.
  const [iconMissing, setIconMissing] = useState(false);
  if (iconMissing) return null;
  const totalMs = status.expiresAtMs === undefined ? undefined : status.expiresAtMs - status.appliedAtMs;
  const remainingFraction = totalMs !== undefined && totalMs > 0 && status.remainingMs !== undefined
    ? Math.max(0, Math.min(1, status.remainingMs / totalMs))
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
      {status.remainingMs !== undefined && <span class="status-remaining">{formatRemaining(status.remainingMs)}</span>}
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

function WaitingForDps({ label = "Waiting for DPS" }: { label?: string } = {}) {
  return (
    <div class="empty">
      <span>{label}</span>
      <span class="empty-help">Press F11 to toggle edit mode, or open Settings from any app window</span>
    </div>
  );
}

function classIcon(archetype: number | undefined): string {
  const icon = archetype === undefined ? "weaver" : CLASS_ICON_BY_ARCHETYPE[archetype] ?? "weaver";
  return `views://assets/class-icons/class-${icon}.webp`;
}

function setLocked(locked: boolean): Promise<void> {
  return electroview.rpc?.request.setLocked({ locked }).then((next) => { controlState.value = next; }) ?? Promise.resolve();
}

function setElementEnabled(id: OverlayElementId, enabled: boolean): Promise<void> {
  return electroview.rpc?.request.setElementEnabled({ id, enabled }).then((next) => { controlState.value = next; }) ?? Promise.resolve();
}


render(<App />, document.getElementById("root")!);
