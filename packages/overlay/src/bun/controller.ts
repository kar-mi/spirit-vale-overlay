import path from "node:path";

import {
  DpsLogFollower,
  DpsSessionLogFollower,
  FishNetStatusTracker,
  LiveCombatService,
} from "@kar-mi/spirit-vale-tools-combat";
import type { CharacterViewState } from "@kar-mi/spirit-vale-tools-character";
import { loadBundledMobRewardCatalog } from "@kar-mi/spirit-vale-tools-rewards";
import type { RateSnapshot } from "@kar-mi/spirit-vale-tools-metrics";
import { SafeSaveQueue } from "@spiritvale/ui-core/safe-save";
import { publishSafely } from "@spiritvale/ui-core/window-publish";
import { GlobalShortcut, Screen } from "electrobun/bun";

import type {
  KeybindAction,
  RateTotals,
  OverlayCharacterState,
  OverlayControlState,
  OverlayDragPreview,
  OverlayElementId,
  OverlaySettingsState,
  OverlayStatus,
  OverlayStatusState,
  OverlayViewState,
  RequiredStatusCategory,
} from "../app-types.ts";
import { KEYBIND_ACTIONS, METER_STAT_TYPE_CYCLE } from "../app-types.ts";
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
  saveOverlaySettings,
  type OverlaySettings,
} from "../settings.ts";

const LIVE_LOG_POLL_MS = 250;
const METER_PUBLISH_MS = 1_000;
/** How often the connected-monitor set is re-read. Electrobun exposes no display-changed event. */
const DISPLAY_RECONCILE_MS = 5_000;
/** Timeline buckets retained per encounter. Beyond this, adjacent buckets merge. */
const TIMELINE_POINTS = 720;
const EXPERIENCE_REQUIREMENTS = loadBundledMobRewardCatalog().experienceRequirements;
const KEYBIND_LABELS: Record<KeybindAction, string> = {
  toggleLock: "lock/unlock",
  resetSession: "reset",
  toggleOverlayVisible: "show/hide",
  cycleMeterStatType: "cycle party meter",
  openLiveDeathLog: "open live death log",
};

/** The overlay's XP and gold tiles read from (and can reset) a tracker owned centrally, shared with the Rewards window, so both stay in sync. */
export interface XpTrackerSource {
  getSnapshot(): RateSnapshot;
  getCoinsSnapshot(): RateTotals;
  reset(): void;
  resetCoins(): void;
  subscribe(listener: () => void): () => void;
}

export interface OverlayControllerOptions {
  logDirectory: string;
  getCharacterState: () => CharacterViewState;
  subscribeCharacter: (listener: (state: CharacterViewState) => void) => () => void;
  xp: XpTrackerSource;
  settingsPath?: string;
  lockOnCreate?: boolean;
  onReset?: () => Promise<void>;
  onOpenLiveDeathLog?: () => Promise<void> | void;
  onLiveLogPathChanged?: (path: string | undefined) => void;
  onSettingsStateChanged?: (state: OverlaySettingsState) => void;
  /** Asks the owner to create/close windows so the live set matches `displaysNeedingSurface`. */
  onSurfacesChanged?: () => void | Promise<void>;
}

/**
 * One overlay surface's connection to the controller.
 *
 * Every surface sees the same character/status/meter data, but only the control state for the
 * elements assigned to its own display.
 */
export interface OverlaySurfaceSink {
  readonly display: string;
  setClickThrough(locked: boolean): void;
  setVisible(visible: boolean): void;
  sendControl(state: OverlayControlState): void;
  sendCharacter(state: OverlayCharacterState): void;
  sendStatuses(state: OverlayStatusState): void;
  sendMeter(state: OverlayViewState["meter"]): void;
  sendDragPreview(preview: OverlayDragPreview | undefined): void;
}

export type OverlayController = Awaited<ReturnType<typeof createOverlayController>>;

/**
 * Everything the overlay does that is not a window: the log pipeline, the settings file, the
 * global shortcuts. Exactly one of these exists however many monitors have tiles on them, so the
 * log follower is read once and each shortcut is registered once.
 */
export async function createOverlayController(options: OverlayControllerOptions) {
  let displays = readDisplays();
  let settings = await loadOverlaySettings(options.settingsPath, displays);
  if (options.lockOnCreate) settings.locked = true;
  let characterState = options.getCharacterState();
  // One service aggregates DPS, TPS and HPS from the same events, retaining bounded per-encounter
  // buckets and the latest finished encounter rather than the session's hits.
  let meter = createLiveMeter();
  let statusTracker = new FishNetStatusTracker();
  const liveLogOverride = process.env.SPIRIT_VALE_COMBAT_LOG;
  const liveLog = liveLogOverride
    ? new DpsLogFollower(liveLogOverride)
    : new DpsSessionLogFollower(options.logDirectory);
  let status: OverlayStatus = "waiting";
  let statusDetail = liveLogOverride
    ? `Looking for ${path.basename(liveLogOverride)}…`
    : "Looking for a combat session…";
  let polling = false;
  let shuttingDown = false;
  let overlayVisible = true;
  const surfaces = new Map<string, OverlaySurfaceSink>();
  /** Control state is projected per display, so the dedupe string has to be per surface too. */
  const lastControlJson = new Map<string, string>();
  const shortcutRegistered = new Map<KeybindAction, boolean>();
  const shortcutErrors = new Map<KeybindAction, string>();
  const logClock = new OverlayLogClock();
  let hasMeterRecord = false;
  const publishCadence = new OverlayPublishCadence(METER_PUBLISH_MS);
  const statusLinger = new OverlayStatusLinger();
  let lastPersonalName = detectedPersonalName(characterState);
  let lastCharacterJson: string | undefined;
  let lastStatusesJson: string | undefined;
  let lastMeterJson: string | undefined;

  const persistence = new SafeSaveQueue<OverlaySettings>({
    label: "overlay settings",
    save: (value) => saveOverlaySettings(value, options.settingsPath),
    onWarning: (warning) => {
      status = "error";
      statusDetail = warning ?? "Could not save overlay settings";
      publishControl();
    },
  });

  for (const action of KEYBIND_ACTIONS) {
    shortcutRegistered.set(action, registerShortcut(action, settings.shortcuts[action]));
  }

  const pollTimer = setInterval(() => void pollLiveLog(), LIVE_LOG_POLL_MS);
  // Cheap enough at 0.2 Hz to be noise, and it is the only thing that stops a window being
  // stranded on a monitor that has been unplugged.
  const displayTimer = setInterval(() => reconcileDisplays(), DISPLAY_RECONCILE_MS);
  displayTimer.unref?.();
  const unsubscribeCharacter = options.subscribeCharacter((next) => {
    characterState = next;
    const personalName = detectedPersonalName(characterState);
    // What the linger is holding belongs to whoever was being tracked; carrying it across a
    // character switch would show their buffs on the new one.
    if (personalName !== lastPersonalName) statusLinger.reset();
    lastPersonalName = personalName;
    meter.setPersonalName(personalName);
    publishControl();
    publishCharacter();
    publishStatuses(relativeNowMs() ?? 0, true);
    publishMeter(true);
  });
  const unsubscribeXp = options.xp.subscribe(() => publishCharacter());

  if (options.lockOnCreate) persistence.schedule(settings);

  const controller = {
    get displays() { return displays; },
    get locked() { return settings.locked; },
    get overlayVisible() { return overlayVisible; },
    /**
     * Display keys that should currently own a window.
     *
     * While unlocked, that is every connected monitor: the user needs somewhere to drop a tile
     * they drag off the edge, and the scrim on each screen is what shows them the drop is allowed.
     * Locking retires the windows that ended up with nothing on them, which is what lets a game on
     * an empty monitor go back to independent flip.
     */
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
    startPolling: () => { void pollLiveLog(); },

    updateLocked,
    setElementEnabled,
    setElementDisplay,
    setHomeDisplay,
    setElementPosition,
    setElementBounds,
    setElementPlacement,
    setElementOpacity,
    relayDragPreview,
    setOverlayVisible: updateOverlayVisible,
    setShortcut,
    setRequiredStatuses,
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
      clearInterval(pollTimer);
      clearInterval(displayTimer);
      unsubscribeCharacter();
      unsubscribeXp();
      for (const action of KEYBIND_ACTIONS) {
        if (shortcutRegistered.get(action)) GlobalShortcut.unregister(settings.shortcuts[action]);
      }
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

  /** Only the tiles on `display`; a surface never learns about another monitor's elements. */
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
    };
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

  function overlayStatusState(nowMs: number): OverlayStatusState {
    const personalName = detectedPersonalName(characterState);
    // Statuses with no data-mine icon (a small upstream gap, e.g. SlowImmunity/BlindImmunity) are
    // omitted entirely rather than shown as a text-initials placeholder.
    // The server drops and re-adds a nearby player's group boons within a fraction of a second, so
    // the toggles they land in are held briefly across that gap. Doing it here rather than per tile
    // means the missing-status warnings below see the held set too and stop flashing in sympathy.
    const activeStatuses = statusLinger.apply(
      statusTracker.getActiveStatusesForName(personalName, nowMs)
        .filter((activeStatus) => activeStatus.spriteId !== undefined),
      nowMs,
    );
    // This split is mirrored by the pickers in ../required-statuses.ts; keep both in sync.
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

  function viewState(display: string): OverlayViewState {
    const nowMs = relativeNowMs() ?? 0;
    const meterState = meter.getState(nowMs);
    const record = meterState.current ?? meterState.latestFinished;
    publishCadence.recordMeterState(meterState.current !== undefined);
    hasMeterRecord = record !== undefined;
    return {
      control: controlState(display),
      character: overlayCharacterState(),
      statuses: overlayStatusState(nowMs),
      meter: overlayMeterState(record, settings.meterStatType, nowMs),
    };
  }

  function updateLocked(locked: boolean): void {
    settings.locked = locked;
    for (const surface of surfaces.values()) surface.setClickThrough(locked);
    persist();
    publishControl();
    // Unlocking opens a surface on every monitor so tiles can be dragged between them; locking
    // closes the ones that hold nothing.
    void options.onSurfacesChanged?.();
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
    // normalizeOverlaySettings re-clamps into the target display's bounds and rejects a key that
    // is not currently connected, so an unknown display quietly stays where it is (on home).
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

  /**
   * Where a tile dragged across a monitor boundary lands: the assignment and the new
   * display-relative position are applied together, so the tile is never briefly clamped into the
   * display it just left.
   */
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

  function setShortcut(action: KeybindAction, shortcut: string): OverlayControlState {
    const normalized = normalizeSingleShortcut(action, shortcut);
    const collidingAction = KEYBIND_ACTIONS.find((other) => other !== action && settings.shortcuts[other] === normalized);
    if (normalized !== shortcut || collidingAction) {
      shortcutErrors.set(action, collidingAction
        ? `Choose a shortcut that isn't already used for ${KEYBIND_LABELS[collidingAction]}.`
        : "Choose a supported shortcut.");
      publishControl();
      return controlState();
    }
    if (normalized === settings.shortcuts[action] && shortcutRegistered.get(action)) return controlState();

    const previousShortcut = settings.shortcuts[action];
    if (shortcutRegistered.get(action)) GlobalShortcut.unregister(previousShortcut);
    let registered = registerShortcut(action, normalized);
    if (registered) {
      settings = { ...settings, shortcuts: { ...settings.shortcuts, [action]: normalized } };
      shortcutErrors.delete(action);
      persist();
    } else {
      registered = registerShortcut(action, previousShortcut);
      shortcutErrors.set(action, `${normalized} is unavailable; the previous shortcut was restored.`);
    }
    shortcutRegistered.set(action, registered);
    publishControl();
    return controlState();
  }

  function updateOverlayVisible(visible: boolean): void {
    overlayVisible = visible;
    for (const surface of surfaces.values()) surface.setVisible(visible);
    publishControl();
  }

  function cycleMeterStatType(): void {
    const currentIndex = METER_STAT_TYPE_CYCLE.indexOf(settings.meterStatType);
    const next = METER_STAT_TYPE_CYCLE[(currentIndex + 1) % METER_STAT_TYPE_CYCLE.length]!;
    settings = { ...settings, meterStatType: next };
    persist();
    publishControl();
    publishMeter(true);
  }

  function registerShortcut(action: KeybindAction, shortcut: string): boolean {
    const registered = GlobalShortcut.register(shortcut, () => {
      if (shuttingDown) return;
      if (action === "toggleLock") updateLocked(!settings.locked);
      else if (action === "toggleOverlayVisible") updateOverlayVisible(!overlayVisible);
      else if (action === "cycleMeterStatType") cycleMeterStatType();
      else if (action === "openLiveDeathLog") {
        void options.onOpenLiveDeathLog?.();
      }
      else if (action === "resetSession" && options.onReset) {
        void options.onReset().catch(() => {
          shortcutErrors.set(action, "Could not reset the capture session.");
          publishControl();
        });
      }
    });
    if (!registered) shortcutErrors.set(action, `${shortcut} is unavailable; it may already be in use.`);
    return registered;
  }

  /**
   * Forwards an in-flight drag to the *other* surfaces so they can draw a ghost where the tile
   * would be if their window could see it. The originating surface is skipped: it is already
   * drawing the real tile under the cursor, and echoing back would fight its local preview.
   */
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
    const next = overlayStatusState(nowMs);
    const json = JSON.stringify(next);
    if (!force && json === lastStatusesJson) return;
    lastStatusesJson = json;
    for (const surface of surfaces.values()) publishSafely(() => surface.sendStatuses(next));
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
    const next = record ? overlayMeterState(record, settings.meterStatType, nowMs) : emptyMeterState();
    const json = JSON.stringify(next);
    if (!force && json === lastMeterJson) return;
    lastMeterJson = json;
    for (const surface of surfaces.values()) publishSafely(() => surface.sendMeter(next));
  }

  async function pollLiveLog(): Promise<void> {
    if (polling || shuttingDown) return;
    polling = true;
    try {
      const batch = await liveLog.poll();
      options.onLiveLogPathChanged?.(batch.path ?? liveLogOverride);
      if (batch.reset) {
        // Only the meter starts over: resetting the session is about the damage numbers. The status
        // tracker deliberately survives, because it is the only record of what is currently active -
        // the game states buffs on apply/refresh and never re-states them for a new log session, so
        // rebuilding it here would blank the buff tiles until every buff happened to be recast.
        // Statuses that genuinely stop applying still clear themselves: they time out via advance(),
        // and a relog or zone change sends an actorIdentity "reset" the tracker already acts on.
        meter = createLiveMeter();
        logClock.rotate();
        publishCadence.reset();
        hasMeterRecord = false;
      }
      for (const { event, observedAtMs } of batch.events) {
        const timelineMs = logClock.observe(observedAtMs);
        if (event.kind === "actorIdentity") {
          meter.consumeIdentity(event, timelineMs);
          // A zone transition or relog clears the tracker outright, so there is nothing left for the
          // linger to be holding open. Note this is deliberately not done for `batch.reset`, where
          // the tracker's view of the world survives on purpose.
          if (event.operation === "reset") statusLinger.reset();
          statusTracker.consumeIdentity(event);
        } else {
          meter.consumeCombat(event, timelineMs);
          statusTracker.consume(event, timelineMs);
        }
      }
      if (batch.events.length > 0) publishCadence.observeEvents();
      const nowMs = relativeNowMs();
      if (nowMs !== undefined) {
        meter.advance(nowMs);
        statusTracker.advance(nowMs);
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
    } catch {
      status = "error";
      statusDetail = `Could not read ${path.basename(liveLogOverride ?? "combat.jsonl")}`;
      publishControl();
    } finally {
      polling = false;
    }
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
