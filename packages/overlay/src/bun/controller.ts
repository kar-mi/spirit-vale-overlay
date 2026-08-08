import path from "node:path";

import {
  DpsLogFollower,
  DpsSessionLogFollower,
  FishNetStatusTracker,
  LiveCombatService,
} from "@kar-mi/spirit-vale-tools-combat";
import type { DpsLogBatch } from "@kar-mi/spirit-vale-tools-combat";
import type { CharacterViewState } from "@kar-mi/spirit-vale-tools-character";
import { loadBundledMobRewardCatalog } from "@kar-mi/spirit-vale-tools-rewards";
import type { RateSnapshot } from "@kar-mi/spirit-vale-tools-metrics";
import { SafeSaveQueue } from "@svoverlay/desktop-platform/safe-save";
import { publishSafely } from "@svoverlay/desktop-platform/window-publish";
import { createPassThroughShortcutListener, type PassThroughShortcutListener } from "@svoverlay/desktop-platform/pass-through-shortcuts";
import { Screen } from "electrobun/bun";

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

/**
 * Tail interval for the `SPIRIT_VALE_COMBAT_LOG` override only.
 *
 * The shipped path is watcher-driven and has no interval at all. `DpsLogFollower` tails one fixed
 * file and exposes no watcher, so that development aid keeps a clock of its own.
 */
const LIVE_LOG_OVERRIDE_POLL_MS = 250;
const METER_PUBLISH_MS = 1_000;
/**
 * Ceiling on how long the overlay will sleep between time-driven passes.
 *
 * Every wake-up is scheduled from something concrete - a status expiry, a lingered chip's deadline,
 * the meter's publish cadence - so this only bounds the arithmetic; nothing normally waits this long.
 */
const MAX_TICK_DELAY_MS = 30_000;
/**
 * Floor on how often the status chips are republished.
 *
 * Batches now arrive as fast as the logger flushes - roughly twenty a second during a fight - where
 * the old poll capped this at four. The chips are a tile of icons, so drawing them at the log's rate
 * buys nothing, and the countdowns on them are ticked in the webview rather than by these messages.
 * A publish refused here is deferred to the scheduled wake, never dropped.
 */
const STATUS_PUBLISH_MS = 250;
/** A fixed escape hatch from edit mode; it is intentionally not configurable. */
const ESCAPE_LOCK_SHORTCUT = "Escape";
/**
 * Collapses repeated lock presses before changing native window styles. This keeps
 * the global-shortcut callback out of a close/create transition for an overlay
 * surface, where WebView2 and Win32 are both updating the same HWND.
 */
const LOCK_STYLE_DEBOUNCE_MS = 50;
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

/** The status chips before the wall-clock stamp the view ticks them from is attached. */
type ProjectedStatusState = Omit<OverlayStatusState, "asOfMs">;

/**
 * Everything the overlay does that is not a window: the log pipeline, the settings file, the
 * pass-through global shortcuts. Exactly one of these exists however many monitors have tiles on
 * them, so the log follower is read once and one keyboard listener serves every shortcut.
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
  const liveLog = createLiveLogSource();
  let status: OverlayStatus = "waiting";
  let statusDetail = liveLogOverride
    ? `Looking for ${path.basename(liveLogOverride)}…`
    : "Looking for a combat session…";
  let shuttingDown = false;
  let overlayVisible = true;
  const surfaces = new Map<string, OverlaySurfaceSink>();
  /** Control state is projected per display, so the dedupe string has to be per surface too. */
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
  /**
   * Tracker revision the published status state was projected from.
   *
   * The projection walks every active status and the JSON compare below stringifies the result, and
   * the display feed re-states statuses that are merely still active. Comparing revisions first
   * skips both for the re-states, which is most of what arrives.
   */
  let lastStatusRevision: number | undefined;
  /** Wall clock of the last status publish, and whether one was deferred waiting on the floor. */
  let lastStatusPublishMs = Number.NEGATIVE_INFINITY;
  let statusPublishDeferred = false;
  /** The one time-driven wake-up, scheduled from whatever is actually due. Absent while idle. */
  let tickTimer: ReturnType<typeof setTimeout> | undefined;
  /** A pending native hit-testing change; settings state is updated immediately. */
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
    // Resetting the linger above retires whatever deadline it was holding.
    scheduleTick();
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
    setOverlayVisible: updateOverlayVisible,
    setShortcut,
    setShortcutCapture,
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
      // Releases this consumer's hold on the shared log source, which disposes its watchers and
      // fallback timer once the last consumer lets go. It also unblocks the follow loop.
      liveLog.close();
      if (tickTimer !== undefined) clearTimeout(tickTimer);
      tickTimer = undefined;
      if (lockStyleTimer !== undefined) clearTimeout(lockStyleTimer);
      lockStyleTimer = undefined;
      clearInterval(displayTimer);
      unsubscribeCharacter();
      unsubscribeXp();
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

  function overlayStatusState(nowMs: number): ProjectedStatusState {
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

  /**
   * Attaches the wall-clock reading the countdowns are ticked from.
   *
   * Kept out of {@link overlayStatusState} so the dedupe below compares the chips themselves - a
   * stamp taken per call would differ every time and defeat it.
   */
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
      meter: overlayMeterState(record, settings.meterStatType, nowMs),
    };
  }

  function updateLocked(locked: boolean): void {
    settings.locked = locked;
    scheduleClickThroughUpdate();
    persist();
    publishControl();
    // Unlocking opens a surface on every monitor so tiles can be dragged between them; locking
    // closes the ones that hold nothing.
    void options.onSurfacesChanged?.();
  }

  /**
   * The shortcut can arrive while a surface is closing or while unlock is adding
   * a surface for another monitor. Defer native style mutation to the next quiet
   * turn and use the final state when applying it.
   */
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
    // The captured key has already been delivered to the settings view. Restore
    // pass-through listening before applying it as a new binding.
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

  /** Suspend every pass-through shortcut while the settings view is listening for a key. */
  function setShortcutCapture(active: boolean): void {
    if (active === shortcutsSuspended) return;
    shortcutsSuspended = active;
    updateShortcutBindings();
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
    if (action === "lockOnEscape") {
      if (!settings.locked) updateLocked(true);
    } else if (action === "toggleLock") updateLocked(!settings.locked);
    else if (action === "toggleOverlayVisible") updateOverlayVisible(!overlayVisible);
    else if (action === "cycleMeterStatType") cycleMeterStatType();
    else if (action === "openLiveDeathLog") {
      void options.onOpenLiveDeathLog?.();
    } else if (action === "resetSession" && options.onReset) {
      void options.onReset().catch(() => {
        shortcutErrors.set(action, "Could not reset the capture session.");
        publishControl();
      });
    }
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
    // The display feed re-states statuses that are merely still active, so most of what reaches here
    // leaves the chips identical. The tracker's revision settles that without walking the active set
    // or stringifying the projection; the linger keeps its say while it is holding a chip, because
    // its deadline moves on no revision at all.
    if (!force
      && statusTracker.revision === lastStatusRevision
      && statusLinger.nextDeadlineMs() === undefined) return;
    // Holding the revision back is what makes this a deferral rather than a drop: the next pass
    // still sees a revision it has not drawn, and the scheduled wake is what brings it back.
    if (!force && Date.now() - lastStatusPublishMs < STATUS_PUBLISH_MS) {
      statusPublishDeferred = true;
      return;
    }
    lastStatusRevision = statusTracker.revision;
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

  /**
   * The combat log as this controller consumes it.
   *
   * The shipped path hands off to the session follower's watcher: `next()` settles when a filesystem
   * event says there is something to read, so an idle overlay does no work at all. The
   * `SPIRIT_VALE_COMBAT_LOG` override tails one fixed file through `DpsLogFollower`, which has no
   * watcher and no shared source behind it, so that development aid keeps a clock of its own.
   */
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

  /**
   * Consumes the log for as long as the overlay is open.
   *
   * The opening `next()` is what establishes the session path and the initial status; after that the
   * loop is woken by the watcher rather than by a timer. `close()` settles a parked `next()`, so
   * shutdown unwinds this rather than leaving it hanging.
   */
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
    // An unchanged batch carries no events, no session change and no truncation, so there is nothing
    // to fold in and nothing that could have moved a projection. The watcher rarely produces one -
    // `next()` settles on something to report - but a merged empty read still can.
    if (!batch.changed) return;
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
    scheduleTick();
  }

  /**
   * Runs the work that is driven by the clock rather than by the log: expiring statuses, dropping a
   * held chip, closing an idle encounter, and refreshing the meter while its numbers are decaying.
   */
  function tick(): void {
    if (shuttingDown) return;
    tickTimer = undefined;
    const nowMs = relativeNowMs();
    if (nowMs !== undefined) {
      meter.advance(nowMs);
      statusTracker.advance(nowMs);
    }
    publishStatuses(nowMs ?? 0);
    if (publishCadence.hasActiveMeter()) publishMeter();
    scheduleTick();
  }

  /**
   * Arms the next time-driven pass, or leaves the overlay asleep when nothing is due.
   *
   * Everything else the overlay reacts to arrives as a filesystem event. What remains are three
   * deadlines nothing will announce - a status lapsing, a lingered chip dropping, and the meter's
   * own republish cadence while an encounter is open - so the wake-up is scheduled from those
   * rather than from a fixed interval. With no encounter and no statuses there is no timer at all.
   */
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
      const expiresAtMs = statusTracker.nextExpiryAtMs();
      if (expiresAtMs !== undefined) consider(expiresAtMs - nowMs);
      const deadlineMs = statusLinger.nextDeadlineMs();
      if (deadlineMs !== undefined) consider(deadlineMs - nowMs);
    }
    // A publish the floor turned away is owed one as soon as the floor lifts.
    if (statusPublishDeferred) consider(lastStatusPublishMs + STATUS_PUBLISH_MS - Date.now());
    // An open encounter is the one case that needs a steady beat: the DPS figures decay between
    // events, and the idle gap that closes the encounter is measured in wall time.
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
