import { batch, computed, signal, type Signal } from "@preact/signals";
import type { FishNetActiveStatus } from "@kar-mi/spirit-vale-tools-combat";

import type {
  BossTimerState,
  KeybindAction,
  OverlayCharacterState,
  OverlayControlState,
  OverlayDisplayPlacement,
  OverlayDragPreview,
  OverlayElementId,
  OverlayElementSettings,
  OverlayLootToastEvent,
  OverlayMeterState,
  OverlayMinimapState,
  OverlayStatusState,
  PersonalDpsMode,
  StatType,
} from "../app-types.ts";
import { OVERLAY_ELEMENT_IDS } from "../app-types.ts";
import { weightWarnLevel } from "../weight-warning.ts";

const LOOT_TOAST_LIFETIME_MS = 3_000;
const STATUS_TICK_MS = 100;
const BOSS_TICK_MS = 1_000;

export interface OverlayChrome {
  locked: boolean;
  meterStatType: StatType;
  personalDpsMode: PersonalDpsMode;
  shortcuts: Record<KeybindAction, string>;
  surface?: OverlayDisplayPlacement;
  displayLayout: OverlayDisplayPlacement[];
  minimapEnabled: boolean;
}

export interface LootToastCardState {
  id: string;
  event: OverlayLootToastEvent;
}

export const chromeState = signal<OverlayChrome | undefined>(undefined);
export const elementStates = Object.fromEntries(
  OVERLAY_ELEMENT_IDS.map((id) => [id, signal<OverlayElementSettings | undefined>(undefined)]),
) as Record<OverlayElementId, Signal<OverlayElementSettings | undefined>>;
export const characterState = signal<OverlayCharacterState | undefined>(undefined);
export const weightWarn = computed(() => weightWarnLevel(characterState.value?.weight));
export const statusState = signal<OverlayStatusState | undefined>(undefined);
export const statusNow = signal(Date.now());
export const bossTimerState = signal<BossTimerState | undefined>(undefined);
export const bossNow = signal(Date.now());
export const meterState = signal<OverlayMeterState | undefined>(undefined);
export const minimapState = signal<OverlayMinimapState | undefined>(undefined);
export const lootToasts = signal<LootToastCardState[]>([]);
export const gridEnabled = signal(false);
export const selectedElementId = signal<OverlayElementId | undefined>(undefined);
export const panelPosition = signal<{ x: number; y: number } | undefined>(undefined);
export const dragPreview = signal<OverlayDragPreview | undefined>(undefined);

let statusTicker: ReturnType<typeof setInterval> | undefined;
let bossTicker: ReturnType<typeof setInterval> | undefined;
let lootToastSequence = 0;
let lastChromeJson: string | undefined;
const lastElementJson = new Map<OverlayElementId, string | undefined>();

export function applyControl(next: OverlayControlState): void {
  batch(() => {
    const chrome: OverlayChrome = {
      locked: next.locked,
      meterStatType: next.meterStatType,
      personalDpsMode: next.personalDpsMode,
      shortcuts: next.shortcuts,
      surface: next.surface,
      displayLayout: next.displayLayout,
      minimapEnabled: next.minimapEnabled,
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

export function applyStatuses(next: OverlayStatusState): void {
  statusState.value = next;
  statusNow.value = Date.now();
  const counting = [next.buffs, next.debuffs, next.toggles]
    .some((statuses: readonly FishNetActiveStatus[] | undefined) => statuses?.some((status) => status.remainingMs !== undefined));
  if (counting && statusTicker === undefined) {
    statusTicker = setInterval(() => { statusNow.value = Date.now(); }, STATUS_TICK_MS);
  } else if (!counting && statusTicker !== undefined) {
    clearInterval(statusTicker);
    statusTicker = undefined;
  }
}

export function applyBossTimers(next: BossTimerState): void {
  bossTimerState.value = next;
  bossNow.value = Date.now();
  if (next.timers.length > 0 && bossTicker === undefined) {
    bossTicker = setInterval(() => { bossNow.value = Date.now(); }, BOSS_TICK_MS);
  } else if (next.timers.length === 0 && bossTicker !== undefined) {
    clearInterval(bossTicker);
    bossTicker = undefined;
  }
}

export function pushLootToast(event: OverlayLootToastEvent): void {
  const id = `${Date.now()}-${lootToastSequence++}`;
  lootToasts.value = [...lootToasts.value, { id, event }];
  setTimeout(() => {
    lootToasts.value = lootToasts.value.filter((card) => card.id !== id);
  }, LOOT_TOAST_LIFETIME_MS);
}
