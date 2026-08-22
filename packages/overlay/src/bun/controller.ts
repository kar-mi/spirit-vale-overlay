import path from "node:path";

import {
  DpsLogFollower,
  DpsSessionLogFollower,
  LiveCombatService,
} from "@kar-mi/spirit-vale-tools-combat";
import type { DpsLogBatch, FishNetActiveStatus, FishNetPosition } from "@kar-mi/spirit-vale-tools-combat";
import type { CharacterViewState } from "@kar-mi/spirit-vale-tools-character";
import { loadBundledMobRewardCatalog } from "@kar-mi/spirit-vale-tools-rewards";
import type { FishNetLootDrop } from "@kar-mi/spirit-vale-tools-rewards";
import type { RateSnapshot } from "@kar-mi/spirit-vale-tools-metrics";
import { SafeSaveQueue } from "@svoverlay/desktop-platform/safe-save";
import { publishSafely } from "@svoverlay/desktop-platform/window-publish";
import { createPassThroughShortcutListener, type PassThroughShortcutListener } from "@svoverlay/desktop-platform/pass-through-shortcuts";
import { getForegroundProcess } from "@svoverlay/desktop-platform/win32";
import { Screen } from "@svoverlay/desktop-runtime";

import type {
  BossTimerState,
  KeybindAction,
  RateTotals,
  OverlayCharacterState,
  OverlayControlState,
  OverlayDragPreview,
  OverlayElementId,
  OverlayLootToastEvent,
  OverlayMinimapState,
  OverlaySettingsState,
  OverlayStatus,
  PersonalDpsMode,
  OverlayStatusState,
  OverlayViewState,
  RequiredStatusCategory,
} from "../app-types.ts";
import { KEYBIND_ACTIONS, METER_STAT_TYPE_CYCLE } from "../app-types.ts";
import { bossRegionsPresent, nextBossRegion, resolveBossRegion } from "@svoverlay/contracts/boss-timers";
import { missingRequiredStatuses } from "../required-statuses.ts";
import { detectedPersonalName } from "../personal-character.ts";
import { personalExperience } from "../personal-experience.ts";
import { personalResources } from "../personal-resources.ts";
import { OverlayLogClock } from "../live-log-clock.ts";
import { emptyMeterState, overlayMeterState } from "../meter-presentation.ts";
import { OverlayPublishCadence } from "../publish-cadence.ts";
import { OverlayStatusLinger } from "../status-linger.ts";
import {
  displayKey,
  displaysNeedingSurface,
  elementsForDisplay,
  type OverlayDisplay,
} from "../display-layout.ts";
import {
  loadOverlaySettings,
  normalizeSingleShortcut,
  normalizeOverlaySettings,
  overlayDisplayOptions,
  resetOverlayShortcuts,
  saveOverlaySettings,
  type OverlaySettings,
} from "../settings.ts";
import {
  classifyForegroundProcess,
  manuallySetVisibility,
  permitsGameKeybind,
  reconcileAutoHide,
  type FocusVisibilityState,
} from "./focus-policy.ts";

const LIVE_LOG_OVERRIDE_POLL_MS = 250;
const METER_PUBLISH_MS = 1_000;
const MAX_TICK_DELAY_MS = 30_000;
const STATUS_PUBLISH_MS = 250;
const ESCAPE_LOCK_SHORTCUT = "Escape";
const LOCK_STYLE_DEBOUNCE_MS = 50;
const DISPLAY_RECONCILE_MS = 5_000;
const AUTO_HIDE_POLL_MS = 400;
const TIMELINE_POINTS = 720;
const EXPERIENCE_REQUIREMENTS = loadBundledMobRewardCatalog().experienceRequirements;
const KEYBIND_LABELS: Record<KeybindAction, string> = {
  toggleLock: "lock/unlock",
  resetSession: "reset",
  toggleOverlayVisible: "show/hide",
  cycleMeterStatType: "cycle party meter",
  openLiveDeathLog: "open live death log",
  resetXpTracker: "reset all-time XP",
  resetGoldTracker: "reset all-time gold",
  toggleMinimap: "show/hide minimap",
  cycleBossRegion: "cycle boss region",
};

export interface OverlayMinimapSourceState {
  self: FishNetPosition | undefined;
  loot: FishNetLootDrop[];
}

export interface XpTrackerSource {
  getSnapshot(): RateSnapshot;
  getCoinsSnapshot(): RateTotals;
  reset(): void;
  resetCoins(): void;
  subscribe(listener: () => void): () => void;
}

export interface BossTimerSource {
  getState(): BossTimerState;
  subscribe(listener: () => void): () => void;
}

export interface OverlayControllerOptions {
  logDirectory: string;
  getCharacterState: () => CharacterViewState;
  subscribeCharacter: (listener: (state: CharacterViewState) => void) => () => void;
  subscribeActiveStatuses: (listener: (statuses: readonly FishNetActiveStatus[]) => void) => () => void;
  subscribeMinimap: (listener: (state: OverlayMinimapSourceState) => void) => () => void;
  subscribeLootToast: (listener: (event: OverlayLootToastEvent) => void) => () => void;
  xp: XpTrackerSource;
  bossTimers: BossTimerSource;
  settingsPath?: string;
  lockOnCreate?: boolean;
  onReset?: () => Promise<void>;
  onOpenLiveDeathLog?: () => Promise<void> | void;
  onLiveLogPathChanged?: (path: string | undefined) => void;
  onSettingsStateChanged?: (state: OverlaySettingsState) => void;
  onSurfacesChanged?: () => void | Promise<void>;
  isAppProcess?: (processId: number) => boolean;
}

export interface OverlaySurfaceSink {
  readonly display: string;
  setClickThrough(locked: boolean): void;
  setVisible(visible: boolean): void;
  sendControl(state: OverlayControlState): void;
  sendCharacter(state: OverlayCharacterState): void;
  sendStatuses(state: OverlayStatusState): void;
  sendMeter(state: OverlayViewState["meter"]): void;
  sendBossTimers(state: BossTimerState): void;
  sendDragPreview(preview: OverlayDragPreview | undefined): void;
  sendMinimap(state: OverlayMinimapState): void;
  sendLootToast(event: OverlayLootToastEvent): void;
}

export type OverlayController = Awaited<ReturnType<typeof createOverlayController>>;

type ProjectedStatusState = Omit<OverlayStatusState, "asOfMs">;

export async function createOverlayController(options: OverlayControllerOptions) {
  let displays = readDisplays();
  let settings = await loadOverlaySettings(options.settingsPath, displays);
  if (options.lockOnCreate) settings.locked = true;
  let characterState = options.getCharacterState();
  let meter = createLiveMeter();
  let activeStatusSnapshot: readonly FishNetActiveStatus[] = [];
  let activeStatusRevision = 0;
  const liveLogOverride = process.env.SPIRIT_VALE_COMBAT_LOG;
  const liveLog = createLiveLogSource();
  let status: OverlayStatus = "waiting";
  let statusDetail = liveLogOverride
    ? `Looking for ${path.basename(liveLogOverride)}…`
    : "Looking for a combat session…";
  let shuttingDown = false;
  let overlayVisible = true;
  let manualHideEngaged = false;
  let autoHidden = false;
  const surfaces = new Map<string, OverlaySurfaceSink>();
  const lastControlJson = new Map<string, string>();
  const shortcutErrors = new Map<KeybindAction, string>();
  let shortcutsSuspended = false;
  const logClock = new OverlayLogClock();
  let hasMeterRecord = false;
  const publishCadence = new OverlayPublishCadence(METER_PUBLISH_MS);
  const statusLinger = new OverlayStatusLinger();
  let lastPersonalName = detectedPersonalName(characterState);
  let lastCharacterJson: string | undefined;
  let lastStatusesJson: string | undefined;
  let lastMeterJson: string | undefined;
  let lastMinimapJson: string | undefined;
  let minimapSource: OverlayMinimapSourceState = { self: undefined, loot: [] };
  let lastBossTimersJson: string | undefined;
  let selectedBossRegion: string | undefined;
  let lastBossRegion: string | undefined;
  let lastStatusRevision: number | undefined;
  let lastStatusPublishMs = Number.NEGATIVE_INFINITY;
  let statusPublishDeferred = false;
  let tickTimer: ReturnType<typeof setTimeout> | undefined;
  let lockStyleTimer: ReturnType<typeof setTimeout> | undefined;

  const persistence = new SafeSaveQueue<OverlaySettings>({
    label: "overlay settings",
    save: (value) => saveOverlaySettings(value, options.settingsPath),
    onWarning: (warning) => {
      status = "error";
      statusDetail = warning ?? "Could not save overlay settings";
      publishControl();
    },
  });

  let shortcutListener: PassThroughShortcutListener<KeybindAction | "lockOnEscape"> | undefined;
  try {
    shortcutListener = createPassThroughShortcutListener(shortcutBindings(), handleShortcut);
  } catch (error) {
    console.warn("[overlay] could not start pass-through shortcuts:", error);
    for (const action of KEYBIND_ACTIONS) shortcutErrors.set(action, "Could not start pass-through shortcuts.");
  }

  const displayTimer = setInterval(() => reconcileDisplays(), DISPLAY_RECONCILE_MS);
  displayTimer.unref?.();
  const autoHideTimer = setInterval(() => checkAutoHide(), AUTO_HIDE_POLL_MS);
  autoHideTimer.unref?.();
  const unsubscribeCharacter = options.subscribeCharacter((next) => {
    characterState = next;
    const personalName = detectedPersonalName(characterState);
    if (personalName !== lastPersonalName) statusLinger.reset();
    lastPersonalName = personalName;
    meter.setPersonalName(personalName);
    publishControl();
    publishCharacter();
    publishStatuses(relativeNowMs() ?? 0, true);
    publishMeter(true);
    // Resetting the linger above retires whatever deadline it was holding.
    scheduleTick();
  });
  const unsubscribeActiveStatuses = options.subscribeActiveStatuses((next) => {
    activeStatusSnapshot = next;
    activeStatusRevision += 1;
    publishStatuses(Date.now());
    scheduleTick();
  });
  const unsubscribeXp = options.xp.subscribe(() => publishCharacter());
  const unsubscribeMinimap = options.subscribeMinimap((next) => {
    minimapSource = next;
    publishMinimap();
  });
  const unsubscribeLootToast = options.subscribeLootToast((event) => {
    if (shuttingDown) return;
    const element = settings.elements.lootToast;
    if (!element.enabled) return;
    const surface = surfaces.get(element.display);
    if (surface) publishSafely(() => surface.sendLootToast(event));
  });
  const unsubscribeBossTimers = options.bossTimers.subscribe(() => publishBossTimers());

  if (options.lockOnCreate) persistence.schedule(settings);

  const controller = {
    get displays() { return displays; },
    get locked() { return settings.locked; },
    get overlayVisible() { return overlayVisible; },
    wantedSurfaces: () => settings.locked
      ? displaysNeedingSurface(settings.elements)
      : displays.map(displayKey),

    registerSurface(surface: OverlaySurfaceSink): void {
      surfaces.set(surface.display, surface);
      lastControlJson.delete(surface.display);
    },
    unregisterSurface(display: string): void {
      surfaces.delete(display);
      lastControlJson.delete(display);
    },

    viewState,
    controlState,
    settingsState,
    overlayCharacterState,
    start: () => { void followLiveLog(); },

    updateLocked,
    setElementEnabled,
    setElementDisplay,
    setHomeDisplay,
    setElementPosition,
    setElementBounds,
    setElementPlacement,
    setElementOpacity,
    relayDragPreview,
    setOverlayVisible: setOverlayVisibleManually,
    setAutoHideWhenUnfocused,
    setKeybindsRequireGameFocus,
    setShortcut,
    resetShortcutsToDefaults,
    setShortcutCapture,
    setRequiredStatuses,
    setPersonalDpsMode,
    setMinimapRarityFilter,
    setMinimapLootChanceFilter,
    resetXpTracker: () => {
      options.xp.reset();
      publishCharacter();
      return overlayCharacterState();
    },
    resetGoldTracker: () => {
      options.xp.resetCoins();
      publishCharacter();
      return overlayCharacterState();
    },

    async shutdown(): Promise<void> {
      if (shuttingDown) return;
      shuttingDown = true;
      liveLog.close();
      if (tickTimer !== undefined) clearTimeout(tickTimer);
      tickTimer = undefined;
      if (lockStyleTimer !== undefined) clearTimeout(lockStyleTimer);
      lockStyleTimer = undefined;
      clearInterval(displayTimer);
      clearInterval(autoHideTimer);
      unsubscribeCharacter();
      unsubscribeActiveStatuses();
      unsubscribeXp();
      unsubscribeMinimap();
      unsubscribeLootToast();
      unsubscribeBossTimers();
      shortcutListener?.close();
      await persistence.flush(settings);
    },
  };
  return controller;

  function readDisplays(): OverlayDisplay[] {
    const all = Screen.getAllDisplays();
    if (all.length > 0) return all;
    // getAllDisplays returns nothing if the FFI call fails; primary is always answerable.
    return [Screen.getPrimaryDisplay()];
  }

  function reconcileDisplays(): void {
    if (shuttingDown) return;
    const next = readDisplays();
    const before = displays.map(displayKey).join("|");
    if (next.map(displayKey).join("|") === before) return;
    displays = next;
    // Re-normalizing re-homes elements whose monitor just vanished and re-clamps the survivors.
    settings = normalizeOverlaySettings(settings, displays);
    persist();
    publishControl(true);
    void options.onSurfacesChanged?.();
  }

  function controlState(display?: string): OverlayControlState {
    const layout = displays.map((candidate) => ({ display: displayKey(candidate), bounds: candidate.bounds }));
    return {
      locked: settings.locked,
      personalName: detectedPersonalName(characterState),
      status,
      statusDetail,
      elements: display === undefined ? settings.elements : elementsForDisplay(settings.elements, display),
      surface: layout.find((candidate) => candidate.display === display),
      displayLayout: layout,
      meterStatType: settings.meterStatType,
      personalDpsMode: settings.personalDpsMode,
      shortcuts: settings.shortcuts,
      shortcutErrors: Object.fromEntries(shortcutErrors),
      overlayVisible,
      requiredStatuses: settings.requiredStatuses,
    };
  }

  function settingsState(): OverlaySettingsState {
    const control = controlState();
    return {
      locked: control.locked,
      personalName: control.personalName,
      elements: settings.elements,
      displays: overlayDisplayOptions(displays),
      homeDisplay: settings.homeDisplay,
      shortcuts: control.shortcuts,
      shortcutErrors: control.shortcutErrors,
      overlayVisible: control.overlayVisible,
      requiredStatuses: control.requiredStatuses,
      personalDpsMode: control.personalDpsMode,
      autoHideWhenUnfocused: settings.autoHideWhenUnfocused,
      keybindsRequireGameFocus: settings.keybindsRequireGameFocus,
      minimapRarityFilter: settings.minimapRarityFilter,
      minimapLootChanceFilter: settings.minimapLootChanceFilter,
    };
  }

  function minimapState(): OverlayMinimapState {
    return {
      player: minimapSource.self
        ? {
          x: minimapSource.self.x,
          z: minimapSource.self.z,
          ...(minimapSource.self.heading === undefined ? {} : { heading: minimapSource.self.heading }),
        }
        : undefined,
      loot: minimapSource.loot.flatMap((drop) => (drop.position === undefined ? [] : [{
        objectId: drop.objectId,
        x: drop.position[0],
        z: drop.position[2],
        ...(drop.displayName === undefined ? {} : { displayName: drop.displayName }),
        ...(drop.spriteId === undefined ? {} : { spriteId: drop.spriteId }),
        ...(drop.rarity === undefined ? {} : { rarity: drop.rarity }),
        ...(drop.lootType === undefined ? {} : { lootType: drop.lootType }),
        ...(drop.lootChance === undefined ? {} : { lootChance: drop.lootChance }),
      }])),
      rarityFilter: settings.minimapRarityFilter,
      lootChanceFilter: settings.minimapLootChanceFilter,
    };
  }

  function setMinimapRarityFilter(rarity: number): OverlayMinimapState {
    settings = normalizeOverlaySettings({ ...settings, minimapRarityFilter: rarity }, displays);
    persist();
    publishMinimap(true);
    return minimapState();
  }

  function setMinimapLootChanceFilter(chance: number): OverlayMinimapState {
    settings = normalizeOverlaySettings({ ...settings, minimapLootChanceFilter: chance }, displays);
    persist();
    publishMinimap(true);
    return minimapState();
  }

  function overlayCharacterState(): OverlayCharacterState {
    const resources = personalResources(characterState.records);
    const experience = personalExperience(characterState.snapshot, EXPERIENCE_REQUIREMENTS);
    return {
      ...resources,
      ...experience,
      ...(characterState.weight ? { weight: characterState.weight } : {}),
      xp: options.xp.getSnapshot(),
      gold: options.xp.getCoinsSnapshot(),
    };
  }

  function overlayStatusState(nowMs: number): ProjectedStatusState {
    const activeStatuses = statusLinger.apply(
      activeStatusSnapshot
        .filter((activeStatus) => activeStatus.expiresAtMs === undefined || activeStatus.expiresAtMs > nowMs)
        .filter((activeStatus) => activeStatus.spriteId !== undefined),
      nowMs,
    );
    const buffs = activeStatuses.filter((activeStatus) => !activeStatus.isDebuff && activeStatus.expiresAtMs !== undefined);
    const toggles = activeStatuses.filter((activeStatus) => activeStatus.expiresAtMs === undefined);
    return {
      buffs,
      debuffs: activeStatuses.filter((activeStatus) => activeStatus.isDebuff && activeStatus.expiresAtMs !== undefined),
      toggles,
      missingStatuses: {
        buffs: missingRequiredStatuses(settings.requiredStatuses.buffs, buffs),
        toggles: missingRequiredStatuses(settings.requiredStatuses.toggles, toggles),
      },
    };
  }

  function stampedStatusState(projected: ProjectedStatusState): OverlayStatusState {
    return { ...projected, asOfMs: Date.now() };
  }

  function viewState(display: string): OverlayViewState {
    const nowMs = relativeNowMs() ?? 0;
    const meterState = meter.getState(nowMs);
    const record = meterState.current ?? meterState.latestFinished;
    publishCadence.recordMeterState(meterState.current !== undefined);
    hasMeterRecord = record !== undefined;
    return {
      control: controlState(display),
      character: overlayCharacterState(),
      statuses: stampedStatusState(overlayStatusState(nowMs)),
      meter: overlayMeterState(record, settings.meterStatType, nowMs, settings.personalDpsMode),
      minimap: minimapState(),
      bossTimers: bossTimerState(),
    };
  }

  function bossTimerState(): BossTimerState {
    const published = options.bossTimers.getState();
    followCurrentBossRegion(published.currentRegion);
    const selected = resolveBossRegion(
      bossRegionsPresent(published.timers),
      selectedBossRegion,
      published.currentRegion,
    );
    return { ...published, ...(selected === undefined ? {} : { selectedRegion: selected }) };
  }

  function followCurrentBossRegion(currentRegion: string | undefined): void {
    if (currentRegion === undefined || currentRegion === lastBossRegion) return;
    lastBossRegion = currentRegion;
    selectedBossRegion = undefined;
  }

  function cycleBossRegion(): void {
    const published = options.bossTimers.getState();
    const regions = bossRegionsPresent(published.timers);
    const showing = resolveBossRegion(regions, selectedBossRegion, published.currentRegion);
    const next = nextBossRegion(regions, showing);
    if (next === undefined || next === showing) return;
    selectedBossRegion = next;
    publishBossTimers();
  }

  function updateLocked(locked: boolean): void {
    settings.locked = locked;
    scheduleClickThroughUpdate();
    persist();
    publishControl();
    // Unlocking opens a surface on every monitor so tiles can be dragged between them; locking closes the ones that hold nothing.
    void options.onSurfacesChanged?.();
  }

  function scheduleClickThroughUpdate(): void {
    if (lockStyleTimer !== undefined) clearTimeout(lockStyleTimer);
    lockStyleTimer = setTimeout(() => {
      lockStyleTimer = undefined;
      if (shuttingDown) return;
      for (const surface of surfaces.values()) surface.setClickThrough(settings.locked);
    }, LOCK_STYLE_DEBOUNCE_MS);
    lockStyleTimer.unref?.();
  }

  function updateElement(
    id: OverlayElementId,
    changes: Partial<OverlaySettings["elements"][OverlayElementId]>,
  ): OverlayControlState {
    const element = settings.elements[id];
    settings = normalizeOverlaySettings({
      ...settings,
      elements: { ...settings.elements, [id]: { ...element, ...changes } },
    }, displays);
    persist();
    publishControl();
    return controlState();
  }

  function setElementEnabled(id: OverlayElementId, enabled: boolean): OverlayControlState {
    const next = updateElement(id, { enabled });
    // Enabling the first tile on a monitor creates its window; disabling the last one closes it.
    void options.onSurfacesChanged?.();
    return next;
  }

  function setElementDisplay(id: OverlayElementId, display: string): OverlayControlState {
    const next = updateElement(id, { display });
    void options.onSurfacesChanged?.();
    return next;
  }

  function setHomeDisplay(display: string): OverlayControlState {
    settings = normalizeOverlaySettings({ ...settings, homeDisplay: display }, displays);
    persist();
    publishControl();
    void options.onSurfacesChanged?.();
    return controlState();
  }

  function setElementPosition(id: OverlayElementId, x: number, y: number): OverlayControlState {
    return updateElement(id, { x, y });
  }

  function setElementBounds(
    id: OverlayElementId,
    rect: { x: number; y: number; width: number; height: number },
  ): OverlayControlState {
    return updateElement(id, rect);
  }

  function setElementPlacement(
    id: OverlayElementId,
    display: string,
    x: number,
    y: number,
  ): OverlayControlState {
    const next = updateElement(id, { display, x, y });
    void options.onSurfacesChanged?.();
    return next;
  }

  function setElementOpacity(id: OverlayElementId, opacity: number): OverlayControlState {
    return updateElement(id, { opacity });
  }

  function setRequiredStatuses(category: RequiredStatusCategory, statusIds: string[]): OverlayControlState {
    settings = normalizeOverlaySettings({
      ...settings,
      requiredStatuses: { ...settings.requiredStatuses, [category]: statusIds },
    }, displays);
    persist();
    publishControl();
    publishStatuses(relativeNowMs() ?? 0, true);
    return controlState();
  }

  function setPersonalDpsMode(mode: PersonalDpsMode): OverlayControlState {
    settings = normalizeOverlaySettings({ ...settings, personalDpsMode: mode }, displays);
    persist();
    publishControl();
    publishMeter(true);
    return controlState();
  }

  function setShortcut(action: KeybindAction, shortcut: string): OverlayControlState {
    setShortcutCapture(false);
    const normalized = normalizeSingleShortcut(action, shortcut);
    const collidingAction = KEYBIND_ACTIONS.find((other) => other !== action && settings.shortcuts[other] === normalized);
    if (normalized !== shortcut || collidingAction) {
      shortcutErrors.set(action, collidingAction
        ? `Choose a shortcut that isn't already used for ${KEYBIND_LABELS[collidingAction]}.`
        : "Choose a supported shortcut.");
      publishControl();
      return controlState();
    }
    if (normalized === settings.shortcuts[action]) return controlState();
    settings = { ...settings, shortcuts: { ...settings.shortcuts, [action]: normalized } };
    shortcutErrors.delete(action);
    updateShortcutBindings();
    persist();
    publishControl();
    return controlState();
  }

  function resetShortcutsToDefaults(): OverlayControlState {
    setShortcutCapture(false);
    settings = resetOverlayShortcuts(settings);
    shortcutErrors.clear();
    updateShortcutBindings();
    persist();
    publishControl();
    return controlState();
  }

  function setShortcutCapture(active: boolean): void {
    if (active === shortcutsSuspended) return;
    shortcutsSuspended = active;
    updateShortcutBindings();
  }

  function updateOverlayVisible(visible: boolean): void {
    if (overlayVisible === visible) return;
    overlayVisible = visible;
    for (const surface of surfaces.values()) surface.setVisible(visible);
    publishControl();
  }

  function setOverlayVisibleManually(visible: boolean): void {
    applyFocusVisibility(manuallySetVisibility(visible));
  }

  function setAutoHideWhenUnfocused(enabled: boolean): OverlayControlState {
    if (settings.autoHideWhenUnfocused === enabled) return controlState();
    const previousVisibility = overlayVisible;
    settings = { ...settings, autoHideWhenUnfocused: enabled };
    persist();
    reconcileFocusVisibility(enabled);
    // A visibility transition publishes both control and launcher settings state itself.
    if (overlayVisible === previousVisibility) publishControl();
    return controlState();
  }

  function setKeybindsRequireGameFocus(enabled: boolean): OverlayControlState {
    if (settings.keybindsRequireGameFocus === enabled) return controlState();
    settings = { ...settings, keybindsRequireGameFocus: enabled };
    persist();
    publishControl();
    return controlState();
  }

  function checkAutoHide(): void {
    if (shuttingDown || !settings.autoHideWhenUnfocused || manualHideEngaged) return;
    reconcileFocusVisibility(true);
  }

  function reconcileFocusVisibility(enabled: boolean): void {
    applyFocusVisibility(reconcileAutoHide(
      { visible: overlayVisible, manualHideEngaged, autoHidden },
      enabled,
      classifyForeground(),
    ));
  }

  function classifyForeground() {
    const foreground = getForegroundProcess();
    if (foreground && options.isAppProcess?.(foreground.pid)) return "app" as const;
    return classifyForegroundProcess(foreground, process.pid);
  }

  function applyFocusVisibility(next: FocusVisibilityState): void {
    manualHideEngaged = next.manualHideEngaged;
    autoHidden = next.autoHidden;
    updateOverlayVisible(next.visible);
  }

  function cycleMeterStatType(): void {
    const currentIndex = METER_STAT_TYPE_CYCLE.indexOf(settings.meterStatType);
    const next = METER_STAT_TYPE_CYCLE[(currentIndex + 1) % METER_STAT_TYPE_CYCLE.length]!;
    settings = { ...settings, meterStatType: next };
    persist();
    publishControl();
    publishMeter(true);
  }

  function shortcutBindings(): Array<{ action: KeybindAction | "lockOnEscape"; shortcut: string }> {
    if (shortcutsSuspended) return [];
    return [
      { action: "lockOnEscape", shortcut: ESCAPE_LOCK_SHORTCUT },
      ...KEYBIND_ACTIONS.map((action) => ({ action, shortcut: settings.shortcuts[action] })),
    ];
  }

  function updateShortcutBindings(): void {
    shortcutListener?.setBindings(shortcutBindings());
  }

  function handleShortcut(action: KeybindAction | "lockOnEscape"): void {
    if (shuttingDown || shortcutsSuspended) return;
    if (action !== "lockOnEscape" && settings.keybindsRequireGameFocus) {
      const foreground = classifyForeground();
      if (!permitsGameKeybind(foreground)) return;
    }
    if (action === "lockOnEscape") {
      if (!settings.locked) updateLocked(true);
    } else if (action === "toggleLock") updateLocked(!settings.locked);
    else if (action === "toggleOverlayVisible") setOverlayVisibleManually(!overlayVisible);
    else if (action === "cycleMeterStatType") cycleMeterStatType();
    else if (action === "openLiveDeathLog") {
      void options.onOpenLiveDeathLog?.();
    } else if (action === "resetSession" && options.onReset) {
      void options.onReset().catch(() => {
        shortcutErrors.set(action, "Could not reset the capture session.");
        publishControl();
      });
    } else if (action === "resetXpTracker") {
      options.xp.reset();
      publishCharacter();
    } else if (action === "resetGoldTracker") {
      options.xp.resetCoins();
      publishCharacter();
    } else if (action === "toggleMinimap") {
      setElementEnabled("minimap", !settings.elements.minimap.enabled);
    } else if (action === "cycleBossRegion") {
      cycleBossRegion();
    }
  }

  function relayDragPreview(preview: OverlayDragPreview | undefined): void {
    if (shuttingDown) return;
    for (const surface of surfaces.values()) {
      if (preview && surface.display === preview.origin) continue;
      publishSafely(() => surface.sendDragPreview(preview));
    }
  }

  function persist(): void {
    persistence.schedule(settings);
  }

  function publishControl(force = false): void {
    if (shuttingDown) return;
    for (const surface of surfaces.values()) {
      const next = controlState(surface.display);
      const json = JSON.stringify(next);
      if (!force && json === lastControlJson.get(surface.display)) continue;
      lastControlJson.set(surface.display, json);
      publishSafely(() => surface.sendControl(next));
    }
    options.onSettingsStateChanged?.(settingsState());
  }

  function publishCharacter(force = false): void {
    if (shuttingDown) return;
    const next = overlayCharacterState();
    const json = JSON.stringify(next);
    if (!force && json === lastCharacterJson) return;
    lastCharacterJson = json;
    for (const surface of surfaces.values()) publishSafely(() => surface.sendCharacter(next));
  }

  function publishStatuses(nowMs: number, force = false): void {
    if (shuttingDown) return;
    if (!force
      && activeStatusRevision === lastStatusRevision
      && statusLinger.nextDeadlineMs() === undefined) return;
    if (!force && Date.now() - lastStatusPublishMs < STATUS_PUBLISH_MS) {
      statusPublishDeferred = true;
      return;
    }
    lastStatusRevision = activeStatusRevision;
    const projected = overlayStatusState(nowMs);
    const json = JSON.stringify(projected);
    if (!force && json === lastStatusesJson) {
      // Nothing to send, so nothing is owed and the floor stays unspent for a real change.
      statusPublishDeferred = false;
      return;
    }
    lastStatusesJson = json;
    statusPublishDeferred = false;
    lastStatusPublishMs = Date.now();
    const next = stampedStatusState(projected);
    for (const surface of surfaces.values()) publishSafely(() => surface.sendStatuses(next));
  }

  function publishBossTimers(): void {
    if (shuttingDown) return;
    const next = bossTimerState();
    const json = JSON.stringify(next);
    if (json === lastBossTimersJson) return;
    lastBossTimersJson = json;
    for (const surface of surfaces.values()) publishSafely(() => surface.sendBossTimers(next));
  }

  function publishMeter(force = false): void {
    if (shuttingDown) return;
    if (!publishCadence.shouldPublishMeter(Date.now(), force)) return;
    const nowMs = relativeNowMs() ?? 0;
    const liveState = meter.getState(nowMs);
    const record = liveState.current ?? liveState.latestFinished;
    publishCadence.recordMeterState(liveState.current !== undefined);
    if (liveState.current === undefined) publishCadence.reset();
    hasMeterRecord = record !== undefined;
    const next = record ? overlayMeterState(record, settings.meterStatType, nowMs, settings.personalDpsMode) : emptyMeterState();
    const json = JSON.stringify(next);
    if (!force && json === lastMeterJson) return;
    lastMeterJson = json;
    for (const surface of surfaces.values()) publishSafely(() => surface.sendMeter(next));
  }

  function publishMinimap(force = false): void {
    if (shuttingDown) return;
    const next = minimapState();
    const json = JSON.stringify(next);
    if (!force && json === lastMinimapJson) return;
    lastMinimapJson = json;
    for (const surface of surfaces.values()) publishSafely(() => surface.sendMinimap(next));
  }

  interface LiveLogSource {
    next(): Promise<DpsLogBatch>;
    close(): void;
  }

  function createLiveLogSource(): LiveLogSource {
    if (liveLogOverride === undefined) {
      const follower = new DpsSessionLogFollower(options.logDirectory);
      return { next: () => follower.next(), close: () => follower.close() };
    }
    const follower = new DpsLogFollower(liveLogOverride);
    return {
      next: async () => {
        await new Promise((resolve) => setTimeout(resolve, LIVE_LOG_OVERRIDE_POLL_MS));
        return follower.poll();
      },
      close: () => {},
    };
  }

  async function followLiveLog(): Promise<void> {
    while (!shuttingDown) {
      let batch: DpsLogBatch;
      try {
        batch = await liveLog.next();
      } catch {
        status = "error";
        statusDetail = `Could not read ${path.basename(liveLogOverride ?? "combat.jsonl")}`;
        publishControl();
        // Back off rather than spinning: whatever failed is unlikely to be fixed by retrying at once.
        await new Promise((resolve) => setTimeout(resolve, LIVE_LOG_OVERRIDE_POLL_MS));
        continue;
      }
      if (shuttingDown) return;
      applyBatch(batch);
    }
  }

  function applyBatch(batch: DpsLogBatch): void {
    if (!batch.changed) return;
    options.onLiveLogPathChanged?.(batch.path ?? liveLogOverride);
    if (batch.reset) {
      meter = createLiveMeter();
      logClock.rotate();
      publishCadence.reset();
      hasMeterRecord = false;
    }
    for (const { event, observedAtMs } of batch.events) {
      const timelineMs = logClock.observe(observedAtMs);
      if (event.kind === "actorIdentity") {
        meter.consumeIdentity(event, timelineMs);
      } else {
        meter.consumeCombat(event, timelineMs);
      }
    }
    if (batch.events.length > 0) publishCadence.observeEvents();
    const nowMs = relativeNowMs();
    if (nowMs !== undefined) {
      meter.advance(nowMs);
    }
    const fileName = path.basename(batch.path ?? liveLogOverride ?? "combat.jsonl");
    if (batch.missing) {
      status = "waiting";
      statusDetail = `Waiting for ${fileName}`;
    } else if (batch.events.length > 0) {
      status = "capturing";
      statusDetail = batch.invalidLines > 0 ? `Reading ${fileName} with skipped lines` : `Reading ${fileName}`;
    } else {
      status = hasMeterRecord ? "ready" : "waiting";
      statusDetail = `Watching ${fileName}`;
    }
    publishControl();
    publishStatuses(nowMs ?? 0);
    if (batch.reset) {
      publishMeter(true);
    } else if (publishCadence.hasActiveMeter()) publishMeter();
    scheduleTick();
  }

  function tick(): void {
    if (shuttingDown) return;
    tickTimer = undefined;
    const nowMs = relativeNowMs();
    if (nowMs !== undefined) {
      meter.advance(nowMs);
    }
    publishStatuses(nowMs ?? 0);
    if (publishCadence.hasActiveMeter()) publishMeter();
    scheduleTick();
  }

  function scheduleTick(): void {
    if (shuttingDown) return;
    if (tickTimer !== undefined) clearTimeout(tickTimer);
    tickTimer = undefined;

    const nowMs = relativeNowMs();
    let delayMs: number | undefined;
    const consider = (candidate: number): void => {
      delayMs = delayMs === undefined ? candidate : Math.min(delayMs, candidate);
    };
    if (nowMs !== undefined) {
      const expiresAtMs = activeStatusSnapshot.reduce<number | undefined>((earliest, activeStatus) => {
        const candidate = activeStatus.expiresAtMs;
        return candidate === undefined || (earliest !== undefined && earliest <= candidate) ? earliest : candidate;
      }, undefined);
      if (expiresAtMs !== undefined) consider(expiresAtMs - nowMs);
      const deadlineMs = statusLinger.nextDeadlineMs();
      if (deadlineMs !== undefined) consider(deadlineMs - nowMs);
    }
    // A publish the floor turned away is owed one as soon as the floor lifts.
    if (statusPublishDeferred) consider(lastStatusPublishMs + STATUS_PUBLISH_MS - Date.now());
    if (publishCadence.hasActiveMeter()) consider(METER_PUBLISH_MS);
    if (delayMs === undefined) return;

    tickTimer = setTimeout(tick, Math.min(Math.max(delayMs, 0), MAX_TICK_DELAY_MS));
    // A pending redraw is never a reason to keep the process alive; the follow loop is.
    tickTimer.unref?.();
  }

  function relativeNowMs(): number | undefined {
    return logClock.nowMs();
  }

  function createLiveMeter(): LiveCombatService {
    return new LiveCombatService({
      personalName: detectedPersonalName(characterState),
      timelinePoints: TIMELINE_POINTS,
    });
  }
}
