
import { formatDuration } from "@svoverlay/ui-kit/format";

export const BOSS_ELIGIBLE_AFTER_MS = 60 * 60_000;
export const BOSS_SPAWN_WINDOW_MS = 30 * 60_000;
export const BOSS_TIMER_EXPIRED_LINGER_MS = 15 * 60_000;

export const MAX_BOSS_CHANNEL = 3;

export function isBossChannel(channel: number | undefined): channel is number {
  return typeof channel === "number"
    && Number.isInteger(channel)
    && channel >= 1
    && channel <= MAX_BOSS_CHANNEL;
}

export type BossTimerSource = "manual" | "gravestone";

export function bossRegionOf(instanceId: string | undefined): string | undefined {
  const trimmed = instanceId?.trim().toLowerCase();
  if (!trimmed) return undefined;
  const prefix = /^[a-z]+/.exec(trimmed)?.[0];
  if (prefix === undefined) return trimmed;
  return REGION_BY_SERVER_PREFIX.get(prefix) ?? prefix;
}

const REGION_BY_SERVER_PREFIX = new Map<string, string>([
  ["na", "na"], ["sun", "na"],
  ["sa", "sa"], ["nova", "sa"],
  ["oce", "oce"], ["aurora", "oce"],
  ["jp", "jp"],
  ["eu", "eu"], ["star", "eu"],
  ["sea", "sea"],
]);

export const BOSS_REGIONS: readonly string[] = ["na", "sa", "oce", "jp", "eu", "sea"];

export const UNKNOWN_BOSS_REGION = "?";

export function bossTimerRegion(timer: Pick<BossTimer, "region">): string {
  return timer.region ?? UNKNOWN_BOSS_REGION;
}

export function bossRegionLabel(region: string, unknownLabel: string = UNKNOWN_BOSS_REGION): string {
  return region === UNKNOWN_BOSS_REGION ? unknownLabel : region.toUpperCase();
}

export function formatBossCountdown(remainingMs: number): string {
  return formatDuration(Math.max(0, remainingMs));
}

const bossClockFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export function formatBossClock(atMs: number): string {
  return bossClockFormat.format(atMs);
}

export function bossRegionsPresent(timers: readonly BossTimer[]): string[] {
  return [...new Set(timers.map(bossTimerRegion))].sort(compareBossRegions);
}

export function resolveBossRegion(
  regions: readonly string[],
  selected: string | undefined,
  currentRegion: string | undefined,
): string | undefined {
  if (selected !== undefined && regions.includes(selected)) return selected;
  if (currentRegion !== undefined && regions.includes(currentRegion)) return currentRegion;
  return regions[0];
}

export function nextBossRegion(regions: readonly string[], current: string | undefined): string | undefined {
  if (regions.length === 0) return undefined;
  const index = current === undefined ? -1 : regions.indexOf(current);
  return regions[(index + 1) % regions.length];
}

export function compareBossRegions(left: string, right: string): number {
  const leftRank = BOSS_REGIONS.indexOf(left);
  const rightRank = BOSS_REGIONS.indexOf(right);
  if (leftRank !== -1 && rightRank !== -1) return leftRank - rightRank;
  if (leftRank !== -1) return -1;
  if (rightRank !== -1) return 1;
  return left.localeCompare(right);
}

export type BossTimerPhase = "waiting" | "window" | "expired";

export interface BossTimer {
  id: string;
  mobId: string;
  bossName: string;
  region?: string;
  instanceId?: string;
  channel?: number;
  killedBy?: string;
  diedAtMs: number;
  source: BossTimerSource;
}

export function isOwnBossKill(
  timer: Pick<BossTimer, "killedBy">,
  playerName: string | undefined,
): boolean {
  const killedBy = timer.killedBy?.trim().toLowerCase();
  const player = playerName?.trim().toLowerCase();
  return killedBy !== undefined && killedBy.length > 0 && killedBy === player;
}

export interface BossTimerState {
  timers: BossTimer[];
  playerName?: string;
  currentRegion?: string;
  selectedRegion?: string;
}

export interface BossCatalogOption {
  mobId: string;
  displayName: string;
  level: number;
}

export function bossTimerKey(
  mobId: string,
  region: string | undefined,
  channel: number | undefined,
): string {
  return `${mobId}\u0000${region ?? "unknown"}\u0000${channel ?? "unknown"}`;
}

export function bossEligibleAtMs(timer: Pick<BossTimer, "diedAtMs">): number {
  return timer.diedAtMs + BOSS_ELIGIBLE_AFTER_MS;
}

export function bossDueAtMs(timer: Pick<BossTimer, "diedAtMs">): number {
  return timer.diedAtMs + BOSS_ELIGIBLE_AFTER_MS + BOSS_SPAWN_WINDOW_MS;
}

export function bossTimerRemoveAtMs(timer: Pick<BossTimer, "diedAtMs">): number {
  return bossDueAtMs(timer) + BOSS_TIMER_EXPIRED_LINGER_MS;
}

export function bossTimerPhase(timer: Pick<BossTimer, "diedAtMs">, nowMs: number): BossTimerPhase {
  if (nowMs < bossEligibleAtMs(timer)) return "waiting";
  if (nowMs < bossDueAtMs(timer)) return "window";
  return "expired";
}
