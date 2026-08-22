/**
 * Boss respawn timers, shared between the launcher (which tracks them) and the overlay (which
 * renders them).
 *
 * A field boss killed in the open world respawns on a fixed schedule: it becomes eligible to spawn
 * again 60 minutes after dying, and is guaranteed to have spawned within the 30-minute window that
 * follows. One timer exists per boss per channel per region; a newly observed or manually recorded
 * death re-anchors that timer to the new time of death.
 */

import { formatDuration } from "@svoverlay/ui-kit/format";

/** How long after dying a boss is ineligible to spawn. */
export const BOSS_ELIGIBLE_AFTER_MS = 60 * 60_000;
/** Length of the spawn window that starts once the boss becomes eligible. */
export const BOSS_SPAWN_WINDOW_MS = 30 * 60_000;
/**
 * How long an expired timer stays on screen before it is dropped.
 *
 * The expiry alert ("the boss has spawned by now") is only useful until the player has seen it;
 * holding it a while covers eyes-on-game stretches without leaving stale rows around forever.
 */
export const BOSS_TIMER_EXPIRED_LINGER_MS = 15 * 60_000;

/**
 * Highest channel a world boss spawns on.
 *
 * Only channels 1-3 run the world-boss rotation. A boss dying on any higher channel was summoned
 * by a player, which respawns nothing, so it must never start a timer — the channel is the only
 * thing that tells the two apart, since a summoned boss is the same catalog mob dying the same way.
 */
export const MAX_BOSS_CHANNEL = 3;

/** Whether `channel` is one a world boss can actually spawn on. */
export function isBossChannel(channel: number | undefined): channel is number {
  return typeof channel === "number"
    && Number.isInteger(channel)
    && channel >= 1
    && channel <= MAX_BOSS_CHANNEL;
}

/**
 * How a timer came to exist.
 *
 * `gravestone` is the marker the server spawns where a boss died, decoded off the wire; it carries
 * the server's own time of death, so it dates a kill nobody here witnessed. `manual` is a person
 * typing in a marker they saw but capture did not.
 *
 * Watching for the death itself was tried and dropped: a Summoner's or Necromancer's pet spawns
 * under the same catalog id as the boss it imitates, and nothing on the wire separates the two
 * reliably. Only a real world boss leaves a marker, so the marker is the evidence.
 */
export type BossTimerSource = "manual" | "gravestone";

/**
 * The region a server instance id belongs to, e.g. `na` for both `na3-12` and `sun1-4`.
 *
 * Instance ids name the machine serving a map, not a world: channels of one map are spread across
 * several roots (`na3` and `na4` have both been seen serving the same map), so the numeric part is
 * an implementation detail that can move. The leading letters are the part that reliably means
 * "which region's boss rotation is this", which is why timers are keyed on them rather than on the
 * whole id. The raw id is still carried on the timer — see {@link BossTimer.instanceId}.
 *
 * Several regions field two server families, so the prefix is mapped onto one canonical region:
 * `sun` is NA, `nova` is SA, `aurora` is OCE and `star` is EU. Without that a player hunting one
 * region would see its bosses split across two lists that never reconcile.
 *
 * An unrecognised prefix is kept as its own region rather than discarded, so a server family added
 * after this was written still groups sensibly instead of vanishing.
 */
export function bossRegionOf(instanceId: string | undefined): string | undefined {
  const trimmed = instanceId?.trim().toLowerCase();
  if (!trimmed) return undefined;
  // The leading letters name the server family; everything after is the machine. Taking just those
  // also makes this idempotent, so re-deriving a region already stored on a timer is a no-op.
  const prefix = /^[a-z]+/.exec(trimmed)?.[0];
  if (prefix === undefined) return trimmed;
  return REGION_BY_SERVER_PREFIX.get(prefix) ?? prefix;
}

/** Region a server prefix belongs to, in the order regions are offered to the player. */
const REGION_BY_SERVER_PREFIX = new Map<string, string>([
  ["na", "na"], ["sun", "na"],
  ["sa", "sa"], ["nova", "sa"],
  ["oce", "oce"], ["aurora", "oce"],
  ["jp", "jp"],
  ["eu", "eu"], ["star", "eu"],
  ["sea", "sea"],
]);

/** Canonical regions in display order, so a tab strip does not reshuffle as timers come and go. */
export const BOSS_REGIONS: readonly string[] = ["na", "sa", "oce", "jp", "eu", "sea"];

/** Stands in for a timer whose region was never observed, so those group together rather than vanish. */
export const UNKNOWN_BOSS_REGION = "?";

/** The region a timer is filed under, including the placeholder for one never observed. */
export function bossTimerRegion(timer: Pick<BossTimer, "region">): string {
  return timer.region ?? UNKNOWN_BOSS_REGION;
}

/**
 * Region as shown to the player: a known region uppercased, e.g. `na` to `NA`.
 *
 * `unknownLabel` lets a surface spell out the placeholder differently — a compact tile keeps the
 * bare {@link UNKNOWN_BOSS_REGION} glyph, a fuller view can afford to say "Unknown" — without
 * duplicating the uppercasing rule itself.
 */
export function bossRegionLabel(region: string, unknownLabel: string = UNKNOWN_BOSS_REGION): string {
  return region === UNKNOWN_BOSS_REGION ? unknownLabel : region.toUpperCase();
}

/** Boss countdowns always render as m:ss (up to 90:00), clamped so a stale tick never shows negative. */
export function formatBossCountdown(remainingMs: number): string {
  return formatDuration(Math.max(0, remainingMs));
}

const bossClockFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** An absolute time as shown on a boss timer, e.g. `4:05 PM`. */
export function formatBossClock(atMs: number): string {
  return bossClockFormat.format(atMs);
}

/** Regions holding at least one timer, in the order regions are offered to the player. */
export function bossRegionsPresent(timers: readonly BossTimer[]): string[] {
  return [...new Set(timers.map(bossTimerRegion))].sort(compareBossRegions);
}

/**
 * Which region a tab strip should be showing.
 *
 * An explicit choice wins while the region it names still holds a timer. Otherwise the region the
 * player is currently in is preferred, so hopping to EU brings EU's timers up without a keypress,
 * and only if that is not among them does it fall back to the first tab.
 */
export function resolveBossRegion(
  regions: readonly string[],
  selected: string | undefined,
  currentRegion: string | undefined,
): string | undefined {
  if (selected !== undefined && regions.includes(selected)) return selected;
  if (currentRegion !== undefined && regions.includes(currentRegion)) return currentRegion;
  return regions[0];
}

/** The region after `current`, wrapping at the end; the first when `current` is not among them. */
export function nextBossRegion(regions: readonly string[], current: string | undefined): string | undefined {
  if (regions.length === 0) return undefined;
  const index = current === undefined ? -1 : regions.indexOf(current);
  return regions[(index + 1) % regions.length];
}

/**
 * Orders regions for display: known ones in {@link BOSS_REGIONS} order, anything unrecognised
 * after them alphabetically rather than dropped, so a new server family still shows up.
 */
export function compareBossRegions(left: string, right: string): number {
  const leftRank = BOSS_REGIONS.indexOf(left);
  const rightRank = BOSS_REGIONS.indexOf(right);
  if (leftRank !== -1 && rightRank !== -1) return leftRank - rightRank;
  if (leftRank !== -1) return -1;
  if (rightRank !== -1) return 1;
  return left.localeCompare(right);
}

/**
 * `waiting`: the boss cannot spawn yet (first 60 minutes).
 * `window`: the spawn window is open — the boss is eligible and may appear at any moment.
 * `expired`: the window has closed, so the boss must have spawned by now.
 */
export type BossTimerPhase = "waiting" | "window" | "expired";

export interface BossTimer {
  /** Identity of the timer: one per boss per channel per region. See {@link bossTimerKey}. */
  id: string;
  mobId: string;
  bossName: string;
  /** Region the kill was seen in, e.g. `na`. Absent when it had not been observed at kill time. */
  region?: string;
  /**
   * Raw server instance id the kill was seen on, e.g. `na3-12`.
   *
   * Deliberately not part of the timer's identity: it names the machine hosting the map, and the
   * same channel has been seen on more than one root. It is recorded so a changing instance under
   * a stable region and channel is observable — which is what would show whether boss rotations
   * are per region or per machine.
   */
  instanceId?: string;
  /** In-game channel number. Absent when capture had not yet observed the channel at kill time. */
  channel?: number;
  /** Player the gravestone credits with the kill. Only known from a gravestone. */
  killedBy?: string;
  diedAtMs: number;
  source: BossTimerSource;
}

/**
 * Whether the marker credits this kill to the character currently being played.
 *
 * Compared when drawn rather than stamped onto the timer, so it needs nothing persisted and cannot
 * be wrong for a marker read in the seconds before capture identifies the local character. The
 * consequence is that switching characters moves the marks, which is the honest reading: it says
 * "yours" relative to who you are now.
 *
 * Case and surrounding space are ignored. Both strings are the game's own name for the same player,
 * so they should already agree exactly; being forgiving costs nothing on a cosmetic marker, and two
 * players separated only by capitalisation is not a thing this has to tell apart.
 */
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
  /**
   * Character being played right now, so a timer crediting them can be marked as their own kill.
   * Absent until capture has identified one.
   */
  playerName?: string;
  /**
   * Region the player is currently in, when capture has reported an instance. Drives which region
   * tab opens by default, so the timers on screen follow the player across a region hop.
   */
  currentRegion?: string;
  /**
   * Region tab explicitly chosen with the cycle keybind or a click in edit mode, overriding the
   * current region until the player moves to a different one. Absent while it is following along.
   */
  selectedRegion?: string;
}

/** One pickable boss for the manual gravestone entry form. */
export interface BossCatalogOption {
  mobId: string;
  displayName: string;
  level: number;
}

/**
 * A boss runs one rotation per channel per region, so those three are the identity. A kill whose
 * region or channel was never observed lands in its own "unknown" bucket rather than colliding
 * with a known one.
 *
 * The server instance is deliberately excluded. Whether a rotation is per region or per machine is
 * still open, and keying on the machine would split one rotation into several every time the game
 * moved a channel between roots — channels of a single map have been seen on both `na3` and `na4`.
 * Merging too coarsely is recoverable, because {@link BossTimer.instanceId} records what was
 * actually seen; fragmenting loses the timer the player is waiting on.
 */
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

/** When the timer stops being worth showing and should be removed outright. */
export function bossTimerRemoveAtMs(timer: Pick<BossTimer, "diedAtMs">): number {
  return bossDueAtMs(timer) + BOSS_TIMER_EXPIRED_LINGER_MS;
}

export function bossTimerPhase(timer: Pick<BossTimer, "diedAtMs">, nowMs: number): BossTimerPhase {
  if (nowMs < bossEligibleAtMs(timer)) return "waiting";
  if (nowMs < bossDueAtMs(timer)) return "window";
  return "expired";
}
