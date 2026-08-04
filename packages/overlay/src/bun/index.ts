import path from "node:path";

import {
  DpsLogFollower,
  DpsSessionLogFollower,
  FishNetStatusTracker,
  LiveCombatService,
} from "@kar-mi/spirit-vale-tools-combat";
import type { CharacterViewState } from "@kar-mi/spirit-vale-tools-character";
import { loadBundledMobRewardCatalog } from "@kar-mi/spirit-vale-tools-rewards";
import type { XpAggregateSnapshot } from "@kar-mi/spirit-vale-tools-rewards";
import { SafeSaveQueue } from "@spiritvale/ui-core/safe-save";
import { hideWindowFromTaskbar, setWindowClickThrough } from "@spiritvale/ui-core/win32";
import type { WindowPlacementStore } from "@spiritvale/ui-core/window-placement";
import { DisposableStore, onceWindowEvent } from "@spiritvale/ui-core/window-lifecycle";
import { BrowserView, BrowserWindow, GlobalShortcut, Screen } from "electrobun/bun";

import type {
  KeybindAction,
  OverlayCharacterState,
  OverlayControlState,
  OverlayRpc,
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
import {
  loadOverlaySettings,
  normalizeSingleShortcut,
  normalizeOverlaySettings,
  saveOverlaySettings,
  type OverlayElementId,
} from "../settings.ts";

const LIVE_LOG_POLL_MS = 250;
const METER_PUBLISH_MS = 1_000;
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

/** The overlay's XP tile reads from (and can reset) a tracker owned centrally, shared with the Rewards window, so both stay in sync. */
export interface XpTrackerSource {
  getSnapshot(): XpAggregateSnapshot;
  reset(): void;
  subscribe(listener: () => void): () => void;
}

export interface OverlayWindowOptions {
  logDirectory: string;
  getCharacterState: () => CharacterViewState;
  subscribeCharacter: (listener: (state: CharacterViewState) => void) => () => void;
  xp: XpTrackerSource;
  settingsPath?: string;
  placements?: WindowPlacementStore;
  lockOnCreate?: boolean;
  onReset?: () => Promise<void>;
  onOpenLiveDeathLog?: () => Promise<void> | void;
  onLiveLogPathChanged?: (path: string | undefined) => void;
  onSettingsStateChanged?: (state: OverlaySettingsState) => void;
  onClosed?: () => void;
}

export async function createOverlayWindow(options: OverlayWindowOptions) {
  const bounds = Screen.getPrimaryDisplay().bounds;
  let settings = await loadOverlaySettings(options.settingsPath, bounds);
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
  let overlayWindow: BrowserWindow;
  let polling = false;
  let shuttingDown = false;
  let closedCallbackSent = false;
  let overlayVisible = true;
  const shortcutRegistered = new Map<KeybindAction, boolean>();
  const shortcutErrors = new Map<KeybindAction, string>();
  const logClock = new OverlayLogClock();
  let hasMeterRecord = false;
  const publishCadence = new OverlayPublishCadence(METER_PUBLISH_MS);
  let lastControlJson: string | undefined;
  let lastCharacterJson: string | undefined;
  let lastStatusesJson: string | undefined;
  let lastMeterJson: string | undefined;
  let unsubscribeCharacter = () => {};
  const lifecycle = new DisposableStore();

  const persistence = new SafeSaveQueue<typeof settings>({
    label: "overlay settings",
    save: (value) => saveOverlaySettings(value, options.settingsPath),
    onWarning: (warning) => {
      status = "error";
      statusDetail = warning ?? "Could not save overlay settings";
      publishControl();
    },
  });

  const overlayRpc = BrowserView.defineRPC<OverlayRpc>({
    maxRequestTime: 30_000,
    handlers: {
      requests: {
        getState: () => viewState(),
        setLocked: ({ locked }) => {
          updateLocked(locked);
          return controlState();
        },
        setElementEnabled: ({ id, enabled }) => setElementEnabled(id, enabled),
        setElementPosition: ({ id, x, y }) => {
          const element = settings.elements[id];
          settings = normalizeOverlaySettings({
            ...settings,
            elements: { ...settings.elements, [id]: { ...element, x, y } },
          }, bounds);
          persist();
          publishControl();
          return controlState();
        },
        setElementBounds: ({ id, x, y, width, height }) => {
          const element = settings.elements[id];
          settings = normalizeOverlaySettings({
            ...settings,
            elements: { ...settings.elements, [id]: { ...element, x, y, width, height } },
          }, bounds);
          persist();
          publishControl();
          return controlState();
        },
        setElementOpacity: ({ id, opacity }) => {
          const element = settings.elements[id];
          settings = normalizeOverlaySettings({
            ...settings,
            elements: { ...settings.elements, [id]: { ...element, opacity } },
          }, bounds);
          persist();
          publishControl();
          return controlState();
        },
        setOverlayVisible: ({ visible }) => {
          updateOverlayVisible(visible);
          return controlState();
        },
        setShortcut: ({ action, shortcut }) => setShortcut(action, shortcut),
        setRequiredStatuses: ({ category, statusIds }) => setRequiredStatuses(category, statusIds),
        resetXpTracker: () => {
          options.xp.reset();
          publishCharacter();
          return overlayCharacterState();
        },
      },
      messages: {},
    },
  });

  overlayWindow = new BrowserWindow({
    title: "Spirit Vale Overlay",
    url: "views://overlayview/index.html",
    frame: bounds,
    titleBarStyle: "hidden",
    transparent: true,
    hidden: true,
    rpc: overlayRpc,
  });
  overlayWindow.setAlwaysOnTop(true);
  hideWindowFromTaskbar(overlayWindow.ptr);
  setWindowClickThrough(overlayWindow.ptr, settings.locked);
  overlayWindow.showInactive();
  lifecycle.add(onceWindowEvent(overlayWindow, "close", () => {
    void shutdown();
    notifyClosed();
  }));
  for (const action of KEYBIND_ACTIONS) {
    shortcutRegistered.set(action, registerShortcut(action, settings.shortcuts[action]));
  }

  const pollTimer = setInterval(() => void pollLiveLog(), LIVE_LOG_POLL_MS);
  unsubscribeCharacter = options.subscribeCharacter((next) => {
    characterState = next;
    meter.setPersonalName(detectedPersonalName(characterState));
    publishControl();
    publishCharacter();
    publishStatuses(relativeNowMs() ?? 0, true);
    publishMeter(true);
  });
  const unsubscribeXp = options.xp.subscribe(() => publishCharacter());

  if (options.lockOnCreate) persistence.schedule(settings);
  void pollLiveLog();

  return {
    show: () => updateOverlayVisible(true),
    activate: () => updateOverlayVisible(true),
    close: async () => {
      await shutdown();
      overlayWindow.close();
      notifyClosed();
    },
    getSettingsState: () => settingsState(),
    setLocked: updateLocked,
    setElementEnabled,
    setOverlayVisible: updateOverlayVisible,
    setShortcut,
    setRequiredStatuses,
  };

  function controlState(): OverlayControlState {
    return {
      locked: settings.locked,
      personalName: detectedPersonalName(characterState),
      status,
      statusDetail,
      elements: settings.elements,
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
      elements: control.elements,
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
    };
  }

  function overlayStatusState(nowMs: number): OverlayStatusState {
    const personalName = detectedPersonalName(characterState);
    // Statuses with no data-mine icon (a small upstream gap, e.g. SlowImmunity/BlindImmunity) are
    // omitted entirely rather than shown as a text-initials placeholder.
    const activeStatuses = statusTracker.getActiveStatusesForName(personalName, nowMs)
      .filter((activeStatus) => activeStatus.spriteId !== undefined);
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

  function viewState(): OverlayViewState {
    const nowMs = relativeNowMs() ?? 0;
    const meterState = meter.getState(nowMs);
    const record = meterState.current ?? meterState.latestFinished;
    publishCadence.recordMeterState(meterState.current !== undefined);
    hasMeterRecord = record !== undefined;
    return {
      control: controlState(),
      character: overlayCharacterState(),
      statuses: overlayStatusState(nowMs),
      meter: overlayMeterState(record, settings.meterStatType, nowMs),
    };
  }

  function updateLocked(locked: boolean): void {
    settings.locked = locked;
    setWindowClickThrough(overlayWindow.ptr, locked);
    persist();
    publishControl();
  }

  function setElementEnabled(id: OverlayElementId, enabled: boolean): OverlayControlState {
    const element = settings.elements[id];
    settings = normalizeOverlaySettings({
      ...settings,
      elements: { ...settings.elements, [id]: { ...element, enabled } },
    }, bounds);
    persist();
    publishControl();
    return controlState();
  }

  function setRequiredStatuses(category: RequiredStatusCategory, statusIds: string[]): OverlayControlState {
    settings = normalizeOverlaySettings({
      ...settings,
      requiredStatuses: { ...settings.requiredStatuses, [category]: statusIds },
    }, bounds);
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
    if (visible) overlayWindow.showInactive();
    else overlayWindow.hide();
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

  function persist(): void {
    persistence.schedule(settings);
  }

  function publishControl(force = false): void {
    if (shuttingDown) return;
    const next = controlState();
    const json = JSON.stringify(next);
    if (!force && json === lastControlJson) return;
    lastControlJson = json;
    try { overlayRpc.send.controlChanged(next); } catch { /* View may still be connecting. */ }
    options.onSettingsStateChanged?.(settingsState());
  }

  function publishCharacter(force = false): void {
    if (shuttingDown) return;
    const next = overlayCharacterState();
    const json = JSON.stringify(next);
    if (!force && json === lastCharacterJson) return;
    lastCharacterJson = json;
    try { overlayRpc.send.characterChanged(next); } catch { /* View may still be connecting. */ }
  }

  function publishStatuses(nowMs: number, force = false): void {
    if (shuttingDown) return;
    const next = overlayStatusState(nowMs);
    const json = JSON.stringify(next);
    if (!force && json === lastStatusesJson) return;
    lastStatusesJson = json;
    try { overlayRpc.send.statusesChanged(next); } catch { /* View may still be connecting. */ }
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
    try { overlayRpc.send.meterChanged(next); } catch { /* View may still be connecting. */ }
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

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    lifecycle.dispose();
    clearInterval(pollTimer);
    unsubscribeCharacter();
    unsubscribeCharacter = () => {};
    unsubscribeXp();
    for (const action of KEYBIND_ACTIONS) {
      if (shortcutRegistered.get(action)) GlobalShortcut.unregister(settings.shortcuts[action]);
    }
    await persistence.flush(settings);
  }

  function notifyClosed(): void {
    if (closedCallbackSent) return;
    closedCallbackSent = true;
    options.onClosed?.();
  }
}

export type { OverlayElementId };
