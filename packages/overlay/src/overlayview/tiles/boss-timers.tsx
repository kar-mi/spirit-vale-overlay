import { useTranslator } from "@svoverlay/i18n/browser";
import type { Translator } from "@svoverlay/i18n/translate";
import {
  bossDueAtMs, bossEligibleAtMs, bossRegionLabel, bossRegionsPresent,
  bossTimerPhase, bossTimerRegion, formatBossClock, formatBossCountdown, isOwnBossKill,
} from "@svoverlay/contracts/boss-timers";
import type { BossTimerPhase } from "@svoverlay/contracts/boss-timers";
import type { BossTimer } from "../../app-types.ts";
import { OverlayElement } from "../element-frame.tsx";
import { bossNow, bossTimerState } from "../store.ts";

const BOSS_ALERT_PULSE_MS = 60_000;
const UNKNOWN_BOSS_CHANNEL = "?";

export function BossTimersOverlayElement({ locked }: { locked: boolean }) {
  const next = bossTimerState.value;
  const timers = next?.timers ?? [];
  const nowMs = bossNow.value;
  return (
    <OverlayElement id="bossTimers" locked={locked} bossAlert={bossTimerAlert(timers, nowMs)}>
      <BossTimersElement
        timers={timers}
        nowMs={nowMs}
        selectedRegion={next?.selectedRegion}
        playerName={next?.playerName}
      />
    </OverlayElement>
  );
}

function bossTimerAlert(timers: readonly BossTimer[], nowMs: number): "window" | "expired" | undefined {
  let alert: "window" | undefined;
  for (const timer of timers) {
    const phase = bossTimerPhase(timer, nowMs);
    if (phase === "expired" && nowMs - bossDueAtMs(timer) < BOSS_ALERT_PULSE_MS) return "expired";
    if (phase === "window" && nowMs - bossEligibleAtMs(timer) < BOSS_ALERT_PULSE_MS) alert = "window";
  }
  return alert;
}

function BossTimersElement(
  { timers, nowMs, selectedRegion, playerName }: {
    timers: readonly BossTimer[];
    nowMs: number;
    selectedRegion: string | undefined;
    playerName: string | undefined;
  },
) {
  const t = useTranslator();
  const regions = bossRegionsPresent(timers);
  if (timers.length === 0) {
    return (
      <div class="boss-timers-empty">
        <span>{t("overlay.bossTimers.empty")}</span>
      </div>
    );
  }
  if (regions.length < 2) {
    return (
      <div class="boss-timers">
        {timers.map((timer) => (
          <BossTimerRow key={timer.id} timer={timer} nowMs={nowMs} playerName={playerName} />
        ))}
      </div>
    );
  }
  const region = selectedRegion !== undefined && regions.includes(selectedRegion)
    ? selectedRegion
    : regions[0]!;
  return (
    <div class="boss-timers">
      <div class="boss-timer-tabs" role="tablist" aria-label={t("overlay.bossTimers.regions")}>
        {regions.map((candidate) => (
          <span
            key={candidate}
            class={`boss-timer-tab boss-${bossRegionAlert(timers, candidate, nowMs) ?? "quiet"}${candidate === region ? " is-active" : ""}`}
            role="tab"
            aria-selected={candidate === region}
          >
            {bossRegionLabel(candidate)}
          </span>
        ))}
      </div>
      {timers.filter((timer) => bossTimerRegion(timer) === region)
        .map((timer) => (
          <BossTimerRow key={timer.id} timer={timer} nowMs={nowMs} region={region} playerName={playerName} />
        ))}
    </div>
  );
}

function bossRegionAlert(
  timers: readonly BossTimer[],
  region: string,
  nowMs: number,
): "expired" | "window" | undefined {
  let alert: "window" | undefined;
  for (const timer of timers) {
    if (bossTimerRegion(timer) !== region) continue;
    const phase = bossTimerPhase(timer, nowMs);
    if (phase === "expired") return "expired";
    if (phase === "window") alert = "window";
  }
  return alert;
}

function BossTimerRow(
  { timer, nowMs, region, playerName }: {
    timer: BossTimer;
    nowMs: number;
    region?: string;
    playerName: string | undefined;
  },
) {
  const t = useTranslator();
  const phase = bossTimerPhase(timer, nowMs);
  const placeLabel = region === undefined
    ? bossPlaceLabel(timer)
    : t("overlay.bossTimers.channel", { channel: timer.channel ?? UNKNOWN_BOSS_CHANNEL });
  const { status, description } = bossTimerStatus(t, timer, phase, nowMs);
  // The tile is compact, so the machine only appears in the tooltip; the Bosses settings tab lists it in full.
  const place = timer.instanceId === undefined ? placeLabel : `${placeLabel} (${timer.instanceId})`;
  return (
    <div class={`boss-timer-row boss-${phase}`} title={t("overlay.bossTimers.tooltip", { boss: timer.bossName, place, description })}>
      <span class="boss-timer-name">
        <span class="boss-timer-name-text">{timer.bossName}</span>
        {isOwnBossKill(timer, playerName) && <span class="boss-own-kill" aria-label={t("overlay.bossTimers.ownKill")}>✓</span>}
      </span>
      <span class="boss-timer-channel">{placeLabel}</span>
      <span class="boss-timer-status">{status}</span>
    </div>
  );
}

function bossPlaceLabel(timer: BossTimer): string {
  return `${bossRegionLabel(bossTimerRegion(timer))} ${timer.channel ?? UNKNOWN_BOSS_CHANNEL}`;
}

function bossTimerStatus(
  t: Translator,
  timer: BossTimer,
  phase: BossTimerPhase,
  nowMs: number,
): { status: string; description: string } {
  if (phase === "waiting") {
    return {
      status: t("overlay.boss.waiting.status", { countdown: formatBossCountdown(bossEligibleAtMs(timer) - nowMs) }),
      description: t("overlay.boss.waiting.description", { clock: formatBossClock(bossEligibleAtMs(timer)) }),
    };
  }
  if (phase === "window") {
    return {
      status: t("overlay.boss.window.status", { countdown: formatBossCountdown(bossDueAtMs(timer) - nowMs) }),
      description: t("overlay.boss.window.description", { clock: formatBossClock(bossDueAtMs(timer)) }),
    };
  }
  return {
    status: t("overlay.boss.spawned.status"),
    description: t("overlay.boss.spawned.description", { clock: formatBossClock(bossDueAtMs(timer)) }),
  };
}
