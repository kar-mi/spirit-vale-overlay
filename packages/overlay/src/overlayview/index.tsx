import { signal } from "@preact/signals";
import { render, type ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Electroview } from "electrobun/view";
import { formatDps, formatDuration } from "@spiritvale/ui-core/format";

import type { FishNetActiveStatus, FishNetDpsTimelinePoint } from "@kar-mi/spirit-vale-tools-combat";
import type {
  OverlayElementId,
  OverlayElementSettings,
  OverlayResource,
  OverlayRpc,
  OverlayState,
} from "../app-types.ts";
import { resourceFill } from "../personal-resources.ts";
import { visiblePartyActors } from "./party-ranking.ts";

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const MIN_ELEMENT_WIDTH = 160;
const MIN_ELEMENT_HEIGHT = 100;
const MIN_RESOURCE_HEIGHT = 40;
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
const state = signal<OverlayState | undefined>(undefined);

const rpc = Electroview.defineRPC<OverlayRpc>({
  handlers: { requests: {}, messages: { stateChanged: (next) => { state.value = next; } } },
});
const electroview = new Electroview({ rpc });
void electroview.rpc?.request.getState({}).then((next) => { state.value = next; });

function App() {
  const next = state.value;
  if (!next) return <main class="overlay-root" />;
  return (
    <main class={next.locked ? "overlay-root" : "overlay-root editing"}>
      {!next.locked && <div class="edit-scrim" />}
      {!next.locked && (
        <div class="edit-controls">
          <p class="edit-hint">Drag elements to arrange the overlay. Press F11 to lock or unlock.</p>
          <button class="lock-pill" type="button" onClick={() => void setLocked(true)}>Lock overlay</button>
        </div>
      )}
      <OverlayElement id="dpsChart" settings={next.elements.dpsChart} locked={next.locked}>
        <DpsChartElement state={next} />
      </OverlayElement>
      <OverlayElement id="personalDps" settings={next.elements.personalDps} locked={next.locked}>
        <PersonalDpsElement state={next} />
      </OverlayElement>
      <OverlayElement id="health" settings={next.elements.health} locked={next.locked}>
        <ResourceElement kind="health" resource={next.health} />
      </OverlayElement>
      <OverlayElement id="mana" settings={next.elements.mana} locked={next.locked}>
        <ResourceElement kind="mana" resource={next.mana} />
      </OverlayElement>
      <OverlayElement id="weight" settings={next.elements.weight} locked={next.locked}>
        <WeightElement state={next} />
      </OverlayElement>
      <OverlayElement id="partyRanking" settings={next.elements.partyRanking} locked={next.locked}>
        <PartyRankingElement state={next} />
      </OverlayElement>
      <OverlayElement id="buffs" settings={next.elements.buffs} locked={next.locked}>
        <StatusGridElement statuses={next.buffs} />
      </OverlayElement>
      <OverlayElement id="debuffs" settings={next.elements.debuffs} locked={next.locked}>
        <StatusGridElement statuses={next.debuffs} />
      </OverlayElement>
    </main>
  );
}

interface OverlayElementProps {
  id: OverlayElementId;
  settings: OverlayElementSettings;
  locked: boolean;
  children: ComponentChildren;
}

function OverlayElement({ id, settings, locked, children }: OverlayElementProps) {
  const [gesture, setGesture] = useState<PointerGesture>();
  const [preview, setPreview] = useState<ElementRect>();
  if (locked && !settings.enabled) return null;
  const rect = preview ?? settings;
  const className = [
    "overlay-element",
    !settings.enabled && "hidden-preview",
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
    const finalRect = preview ?? gesture.start;
    const wasResize = gesture.kind === "resize";
    setGesture(undefined);
    setPreview(undefined);
    const request = wasResize
      ? electroview.rpc?.request.setElementBounds({ id, ...finalRect })
      : electroview.rpc?.request.setElementPosition({ id, x: finalRect.x, y: finalRect.y });
    void request?.then((next) => { state.value = next; });
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
      {!locked && (
        <label
          class="element-opacity-control"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span>Tile opacity</span>
          <output>{Math.round(settings.opacity * 100)}%</output>
          <input
            type="range"
            min="0.2"
            max="1"
            step="0.05"
            value={settings.opacity}
            onInput={(event) => {
              const request = electroview.rpc?.request.setElementOpacity({
                id,
                opacity: event.currentTarget.valueAsNumber,
              });
              void request?.then((next) => { state.value = next; });
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
  return {
    ...start,
    x: clamp(start.x + dx, 0, Math.max(0, window.innerWidth - start.width)),
    y: clamp(start.y + dy, 0, Math.max(0, window.innerHeight - start.height)),
  };
}

function resizeRect(start: ElementRect, edge: ResizeEdge, dx: number, dy: number, id: OverlayElementId): ElementRect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  const minimumHeight = id === "health" || id === "mana" || id === "weight" || id === "buffs" || id === "debuffs"
    ? MIN_RESOURCE_HEIGHT
    : MIN_ELEMENT_HEIGHT;
  if (edge.includes("w")) left = clamp(start.x + dx, 0, right - MIN_ELEMENT_WIDTH);
  if (edge.includes("e")) right = clamp(start.x + start.width + dx, left + MIN_ELEMENT_WIDTH, window.innerWidth);
  if (edge.includes("n")) top = clamp(start.y + dy, 0, bottom - minimumHeight);
  if (edge.includes("s")) bottom = clamp(start.y + start.height + dy, top + minimumHeight, window.innerHeight);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function DpsChartElement({ state: next }: { state: OverlayState }) {
  const personal = next.snapshot?.personal;
  const points = personal?.timeline ?? partyTimeline(next);
  const duration = personal?.durationMs ?? next.snapshot?.durationMs ?? 0;
  return (
    <div class="element-content">
      <h2 class="element-title">{personal ? "Personal DPS over time" : "Party DPS over time"}</h2>
      {points.length ? <DamageChart points={points} durationMs={duration} /> : <WaitingForDps />}
    </div>
  );
}

function DamageChart({ points, durationMs }: { points: readonly FishNetDpsTimelinePoint[]; durationMs: number }) {
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
    <svg class="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="DPS over time chart">
      <line class="chart-grid" x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} />
      <polyline class="chart-line" points={linePoints} />
      <text class="chart-label" x="0" y={top + 4}>{compactFormat.format(maxValue)}</text>
      <text class="chart-label" x={left} y={height - 5}>0:00</text>
      <text class="chart-label" text-anchor="end" x={width - right} y={height - 5}>{formatDuration(durationMs)}</text>
    </svg>
  );
}

function PersonalDpsElement({ state: next }: { state: OverlayState }) {
  const personal = next.snapshot?.personal;
  return (
    <div class="element-content">
      <div class="personal-heading">
        <img class="personal-class-icon" src={classIcon(personal?.archetype)} alt="" aria-hidden="true" />
        <h2 class="element-title">Personal DPS</h2>
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

function WeightElement({ state: next }: { state: OverlayState }) {
  const weight = next.weight;
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

function ResourceElement({ kind, resource }: { kind: "health" | "mana"; resource: OverlayResource | undefined }) {
  const label = kind === "health" ? "HP" : "MP";
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

function PartyRankingElement({ state: next }: { state: OverlayState }) {
  const actors = visiblePartyActors(
    next.snapshot?.actors ?? [],
    next.snapshotNowMs ?? next.snapshot?.lastDamageAtMs ?? 0,
  );
  const maxDps = Math.max(1, ...actors.map((actor) => actor.dps));
  const duration = next.snapshot?.durationMs ?? 0;
  return (
    <div class="element-content">
      <div class="party-heading">
        <div>
          <h2 class="element-title">Party encounter DPS</h2>
          <span class="party-duration">{formatDuration(duration)}</span>
        </div>
        <span class="party-reset-hint">{next.resetShortcut} to reset</span>
      </div>
      {actors.length ? <div class="ranking">{actors.map((actor, index) => (
        <div
          class="ranking-row"
          key={actor.actorIds[0]}
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

function StatusGridElement({ statuses }: { statuses: FishNetActiveStatus[] | undefined }) {
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
      {list.map((status) => <StatusCell key={status.statusId} status={status} />)}
    </div>
  );
}

function StatusCell({ status }: { status: FishNetActiveStatus }) {
  const totalMs = status.expiresAtMs === undefined ? undefined : status.expiresAtMs - status.appliedAtMs;
  const remainingFraction = totalMs !== undefined && totalMs > 0 && status.remainingMs !== undefined
    ? Math.max(0, Math.min(1, status.remainingMs / totalMs))
    : undefined;
  return (
    <div
      class="status-cell"
      style={remainingFraction === undefined ? undefined : `--status-remaining:${Math.round(remainingFraction * 100)}%`}
      title={status.displayName}
    >
      <img class="status-icon" src={statusIcon(status.spriteId)} alt="" aria-hidden="true" />
      {remainingFraction !== undefined && <span class="status-timer-fill" aria-hidden="true" />}
      {status.level > 1 && <span class="status-level">{status.level}</span>}
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

function WaitingForDps() {
  return (
    <div class="empty">
      <span>Waiting for DPS</span>
      <span class="empty-help">Press F11 to toggle overlay settings, or click on overlay button</span>
    </div>
  );
}

function classIcon(archetype: number | undefined): string {
  const icon = archetype === undefined ? "weaver" : CLASS_ICON_BY_ARCHETYPE[archetype] ?? "weaver";
  return `views://assets/class-icons/class-${icon}.webp`;
}

function partyTimeline(next: OverlayState): FishNetDpsTimelinePoint[] {
  const buckets = new Map<number, FishNetDpsTimelinePoint>();
  for (const actor of next.snapshot?.actors ?? []) {
    for (const point of actor.timeline) {
      const current = buckets.get(point.elapsedMs);
      buckets.set(point.elapsedMs, {
        elapsedMs: point.elapsedMs,
        damage: (current?.damage ?? 0) + point.damage,
        dps: (current?.dps ?? 0) + point.dps,
        cumulativeDamage: (current?.cumulativeDamage ?? 0) + point.cumulativeDamage,
      });
    }
  }
  return [...buckets.values()].sort((left, right) => left.elapsedMs - right.elapsedMs);
}

function setLocked(locked: boolean): Promise<void> {
  return electroview.rpc?.request.setLocked({ locked }).then((next) => { state.value = next; }) ?? Promise.resolve();
}

function setElementEnabled(id: OverlayElementId, enabled: boolean): Promise<void> {
  return electroview.rpc?.request.setElementEnabled({ id, enabled }).then((next) => { state.value = next; }) ?? Promise.resolve();
}


render(<App />, document.getElementById("root")!);
