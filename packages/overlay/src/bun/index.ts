import path from "node:path";

import {
  DpsLogFollower,
  DpsSessionLogFollower,
  FishNetStatusTracker,
  LiveCombatService,
} from "@kar-mi/spirit-vale-tools-combat";
import type { CombatEncounterRecord } from "@kar-mi/spirit-vale-tools-combat";
import type { CharacterViewState } from "@kar-mi/spirit-vale-tools-character";
import { loadBundledMobRewardCatalog } from "@kar-mi/spirit-vale-tools-rewards";
import type { XpAggregateSnapshot } from "@kar-mi/spirit-vale-tools-rewards";
import { SafeSaveQueue } from "@spiritvale/ui-core/safe-save";
import { hideWindowFromTaskbar, setWindowClickThrough } from "@spiritvale/ui-core/win32";
import type { WindowPlacementStore } from "@spiritvale/ui-core/window-placement";
import { DisposableStore, onceWindowEvent } from "@spiritvale/ui-core/window-lifecycle";
import { BrowserView, BrowserWindow, GlobalShortcut, Screen } from "electrobun/bun";

import type { KeybindAction, OverlayRpc, OverlayState, OverlayStatus, RequiredStatusCategory } from "../app-types.ts";
import { KEYBIND_ACTIONS, METER_STAT_TYPE_CYCLE } from "../app-types.ts";
import { missingRequiredStatuses } from "../required-statuses.ts";
import { detectedPersonalName } from "../personal-character.ts";
import { personalExperience } from "../personal-experience.ts";
import { personalResources } from "../personal-resources.ts";
import {
  loadOverlaySettings,
  normalizeSingleShortcut,
  normalizeOverlaySettings,
  saveOverlaySettings,
  type OverlayElementId,
} from "../settings.ts";

const LIVE_LOG_POLL_MS = 1_000;
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
  onSettingsStateChanged?: (state: OverlayState) => void;
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
  let publishing = false;
  let shuttingDown = false;
  let closedCallbackSent = false;
  let overlayVisible = true;
  const shortcutRegistered = new Map<KeybindAction, boolean>();
  const shortcutErrors = new Map<KeybindAction, string>();
  let lastEventObservedAtMs: number | undefined;
  let lastEventWallMs: number | undefined;
  let unsubscribeCharacter = () => {};
  const lifecycle = new DisposableStore();

  const persistence = new SafeSaveQueue<typeof settings>({
    label: "overlay settings",
    save: (value) => saveOverlaySettings(value, options.settingsPath),
    onWarning: (warning) => {
      status = "error";
      statusDetail = warning ?? "Could not save overlay settings";
      publish();
    },
  });

  const overlayRpc = BrowserView.defineRPC<OverlayRpc>({
    maxRequestTime: 30_000,
    handlers: {
      requests: {
        getState: () => appState(),
        setLocked: ({ locked }) => {
          updateLocked(locked);
          return appState();
        },
        setElementEnabled: ({ id, enabled }) => setElementEnabled(id, enabled),
        setElementPosition: ({ id, x, y }) => {
          const element = settings.elements[id];
          settings = normalizeOverlaySettings({
            ...settings,
            elements: { ...settings.elements, [id]: { ...element, x, y } },
          }, bounds);
          persist();
          publish();
          return appState();
        },
        setElementBounds: ({ id, x, y, width, height }) => {
          const element = settings.elements[id];
          settings = normalizeOverlaySettings({
            ...settings,
            elements: { ...settings.elements, [id]: { ...element, x, y, width, height } },
          }, bounds);
          persist();
          publish();
          return appState();
        },
        setElementOpacity: ({ id, opacity }) => {
          const element = settings.elements[id];
          settings = normalizeOverlaySettings({
            ...settings,
            elements: { ...settings.elements, [id]: { ...element, opacity } },
          }, bounds);
          persist();
          publish();
          return appState();
        },
        setOverlayVisible: ({ visible }) => {
          updateOverlayVisible(visible);
          return appState();
        },
        setShortcut: ({ action, shortcut }) => setShortcut(action, shortcut),
        setRequiredStatuses: ({ category, statusIds }) => setRequiredStatuses(category, statusIds),
        resetXpTracker: () => {
          options.xp.reset();
          return appState();
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
    publish();
  });
  const unsubscribeXp = options.xp.subscribe(() => publish());

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
    getSettingsState: () => appState(),
    setLocked: updateLocked,
    setElementEnabled,
    setOverlayVisible: updateOverlayVisible,
    setShortcut,
    setRequiredStatuses,
  };

  function appState(): OverlayState {
    const snapshotNowMs = relativeNowMs();
    const record = latestRecord();
    const snapshot = record?.dps;
    const tankedSnapshot = record?.tps.detail;
    const healSnapshot = record?.hps.detail;
    const resources = personalResources(characterState.records);
    const experience = personalExperience(characterState.snapshot, EXPERIENCE_REQUIREMENTS);
    const personalName = detectedPersonalName(characterState);
    // Statuses with no data-mine icon (a small upstream gap, e.g. SlowImmunity/BlindImmunity) are
    // omitted entirely rather than shown as a text-initials placeholder.
    const activeStatuses = statusTracker.getActiveStatusesForName(personalName, snapshotNowMs ?? 0)
      .filter((activeStatus) => activeStatus.spriteId !== undefined);
    // This split is mirrored by the pickers in ../required-statuses.ts; keep both in sync.
    const buffs = activeStatuses.filter((activeStatus) => !activeStatus.isDebuff && activeStatus.expiresAtMs !== undefined);
    const toggles = activeStatuses.filter((activeStatus) => activeStatus.expiresAtMs === undefined);
    return {
      locked: settings.locked,
      personalName,
      status,
      statusDetail,
      elements: settings.elements,
      meterStatType: settings.meterStatType,
      shortcuts: settings.shortcuts,
      shortcutErrors: Object.fromEntries(shortcutErrors),
      overlayVisible,
      ...(snapshot ? { snapshot, snapshotNowMs: snapshotNowMs ?? snapshot.lastDamageAtMs } : {}),
      ...(tankedSnapshot ? { tankedSnapshot } : {}),
      ...(healSnapshot ? { healSnapshot } : {}),
      ...resources,
      ...experience,
      ...(characterState.weight ? { weight: characterState.weight } : {}),
      xp: options.xp.getSnapshot(),
      buffs,
      debuffs: activeStatuses.filter((activeStatus) => activeStatus.isDebuff && activeStatus.expiresAtMs !== undefined),
      toggles,
      requiredStatuses: settings.requiredStatuses,
      missingStatuses: {
        buffs: missingRequiredStatuses(settings.requiredStatuses.buffs, buffs),
        toggles: missingRequiredStatuses(settings.requiredStatuses.toggles, toggles),
      },
    };
  }

  function updateLocked(locked: boolean): void {
    settings.locked = locked;
    setWindowClickThrough(overlayWindow.ptr, locked);
    persist();
    publish();
  }

  function setElementEnabled(id: OverlayElementId, enabled: boolean): OverlayState {
    const element = settings.elements[id];
    settings = normalizeOverlaySettings({
      ...settings,
      elements: { ...settings.elements, [id]: { ...element, enabled } },
    }, bounds);
    persist();
    publish();
    return appState();
  }

  function setRequiredStatuses(category: RequiredStatusCategory, statusIds: string[]): OverlayState {
    settings = normalizeOverlaySettings({
      ...settings,
      requiredStatuses: { ...settings.requiredStatuses, [category]: statusIds },
    }, bounds);
    persist();
    publish();
    return appState();
  }

  function setShortcut(action: KeybindAction, shortcut: string): OverlayState {
    const normalized = normalizeSingleShortcut(action, shortcut);
    const collidingAction = KEYBIND_ACTIONS.find((other) => other !== action && settings.shortcuts[other] === normalized);
    if (normalized !== shortcut || collidingAction) {
      shortcutErrors.set(action, collidingAction
        ? `Choose a shortcut that isn't already used for ${KEYBIND_LABELS[collidingAction]}.`
        : "Choose a supported shortcut.");
      publish();
      return appState();
    }
    if (normalized === settings.shortcuts[action] && shortcutRegistered.get(action)) return appState();

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
    publish();
    return appState();
  }

  function updateOverlayVisible(visible: boolean): void {
    overlayVisible = visible;
    if (visible) overlayWindow.showInactive();
    else overlayWindow.hide();
    publish();
  }

  function cycleMeterStatType(): void {
    const currentIndex = METER_STAT_TYPE_CYCLE.indexOf(settings.meterStatType);
    const next = METER_STAT_TYPE_CYCLE[(currentIndex + 1) % METER_STAT_TYPE_CYCLE.length]!;
    settings = { ...settings, meterStatType: next };
    persist();
    publish();
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
          publish();
        });
      }
    });
    if (!registered) shortcutErrors.set(action, `${shortcut} is unavailable; it may already be in use.`);
    return registered;
  }

  function persist(): void {
    persistence.schedule(settings);
  }

  function publish(): void {
    if (publishing || shuttingDown) return;
    publishing = true;
    try {
      const state = appState();
      try { overlayRpc.send.stateChanged(state); } catch { /* View may still be connecting. */ }
      options.onSettingsStateChanged?.(state);
    } catch (error) {
      console.error("[spiritvale-overlay] publish failed:", error);
    } finally {
      publishing = false;
    }
  }

  async function pollLiveLog(): Promise<void> {
    if (polling || shuttingDown) return;
    polling = true;
    try {
      const batch = await liveLog.poll();
      options.onLiveLogPathChanged?.(batch.path ?? liveLogOverride);
      if (batch.reset) {
        meter = createLiveMeter();
        statusTracker = new FishNetStatusTracker();
        lastEventObservedAtMs = undefined;
        lastEventWallMs = undefined;
      }
      let batchLastObservedAtMs: number | undefined;
      for (const { event, observedAtMs } of batch.events) {
        if (event.kind === "actorIdentity") {
          meter.consumeIdentity(event, observedAtMs);
          statusTracker.consumeIdentity(event);
        } else {
          meter.consumeCombat(event, observedAtMs);
          statusTracker.consume(event, observedAtMs);
        }
        batchLastObservedAtMs = Math.max(batchLastObservedAtMs ?? observedAtMs, observedAtMs);
      }
      if (batchLastObservedAtMs !== undefined) {
        lastEventObservedAtMs = batchLastObservedAtMs;
        lastEventWallMs = Date.now();
      }
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
        status = latestRecord() ? "ready" : "waiting";
        statusDetail = `Watching ${fileName}`;
      }
      publish();
    } catch {
      status = "error";
      statusDetail = `Could not read ${path.basename(liveLogOverride ?? "combat.jsonl")}`;
      publish();
    } finally {
      polling = false;
    }
  }

  function relativeNowMs(): number | undefined {
    if (lastEventObservedAtMs === undefined || lastEventWallMs === undefined) return undefined;
    return lastEventObservedAtMs + (Date.now() - lastEventWallMs);
  }

  function createLiveMeter(): LiveCombatService {
    return new LiveCombatService({
      personalName: detectedPersonalName(characterState),
      timelinePoints: TIMELINE_POINTS,
    });
  }

  /** The encounter in progress, or the most recent one once it has ended. */
  function latestRecord(): CombatEncounterRecord | undefined {
    const state = meter.getState(relativeNowMs());
    return state.current ?? state.latestFinished;
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
