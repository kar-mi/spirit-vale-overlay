import { batch, computed, signal, type Signal } from "@preact/signals";
import { Electroview } from "electrobun/view";
import { repairRendererPayload } from "@svoverlay/ui-kit/renderer-text";

import {
  OVERLAY_ELEMENT_IDS,
  type KeybindAction,
  type OverlayCharacterState,
  type OverlayControlState,
  type OverlayDisplayPlacement,
  type OverlayDragPreview,
  type OverlayElementId,
  type OverlayElementSettings,
  type OverlayMeterState,
  type OverlayRpc,
  type OverlayStatusState,
  type PersonalDpsMode,
  type StatType,
} from "../app-types.ts";
import { weightWarnLevel } from "../weight-warning.ts";

const STATUS_TICK_MS = 100;

export interface OverlayChrome {
  locked: boolean;
  meterStatType: StatType;
  personalDpsMode: PersonalDpsMode;
  shortcuts: Record<KeybindAction, string>;
  surface?: OverlayDisplayPlacement;
  displayLayout: OverlayDisplayPlacement[];
}

export const chromeState = signal<OverlayChrome | undefined>(undefined);
export const elementStates = Object.fromEntries(
  OVERLAY_ELEMENT_IDS.map((id) => [id, signal<OverlayElementSettings | undefined>(undefined)]),
) as Record<OverlayElementId, Signal<OverlayElementSettings | undefined>>;
export const characterState = signal<OverlayCharacterState | undefined>(undefined);
export const weightWarn = computed(() => weightWarnLevel(characterState.value?.weight));
export const statusState = signal<OverlayStatusState | undefined>(undefined);
export const statusNow = signal(Date.now());
export const meterState = signal<OverlayMeterState | undefined>(undefined);
export const gridEnabled = signal(false);
export const dragPreview = signal<OverlayDragPreview | undefined>(undefined);

let statusTicker: ReturnType<typeof setInterval> | undefined;
let lastChromeJson: string | undefined;
const lastElementJson = new Map<OverlayElementId, string | undefined>();
let pendingDragPreview: OverlayDragPreview | undefined;
let dragPreviewFrame = 0;

export function sendDragPreview(preview: OverlayDragPreview): void {
  pendingDragPreview = preview;
  if (dragPreviewFrame) return;
  dragPreviewFrame = requestAnimationFrame(() => {
    dragPreviewFrame = 0;
    if (pendingDragPreview) electroview.rpc?.send.dragPreview(pendingDragPreview);
    pendingDragPreview = undefined;
  });
}

export function endDragPreview(): void {
  if (dragPreviewFrame) cancelAnimationFrame(dragPreviewFrame);
  dragPreviewFrame = 0;
  pendingDragPreview = undefined;
  electroview.rpc?.send.dragPreviewEnded({});
}

export function applyControl(next: OverlayControlState): void {
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
      const element = next.elements[id];
      const json = element === undefined ? undefined : JSON.stringify(element);
      if (json === lastElementJson.get(id)) continue;
      lastElementJson.set(id, json);
      elementStates[id].value = element;
    }
  });
}

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

const rpc = Electroview.defineRPC<OverlayRpc>({
  handlers: { requests: {}, messages: {
    controlChanged: (next) => { applyControl(repairRendererPayload(next)); },
    characterChanged: (next) => { characterState.value = repairRendererPayload(next); },
    statusesChanged: (next) => { applyStatuses(repairRendererPayload(next)); },
    meterChanged: (next) => { meterState.value = repairRendererPayload(next); },
    dragPreviewChanged: (next) => { dragPreview.value = next; },
  } },
});

export const electroview = new Electroview({ rpc });

void electroview.rpc?.request.getState({}).then((next) => {
  const repaired = repairRendererPayload(next);
  batch(() => {
    applyControl(repaired.control);
    characterState.value = repaired.character;
    applyStatuses(repaired.statuses);
    meterState.value = repaired.meter;
  });
});
