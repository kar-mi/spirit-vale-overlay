import type { FishNetActorIdentityEvent, FishNetCombatEvent } from "@kar-mi/spirit-vale-tools-combat";
import type { MeterActorRow, MeterEncounterSnapshot, MeterPersonalMatch, MeterSkillRow, MeterTimelinePoint } from "./app-types.ts";

export interface HpsMeterOptions {
  personalName?: string;
  personalActorId?: number;
  /** Milliseconds of recent healing included in current HPS. Defaults to 5 seconds. */
  currentWindowMs?: number;
  /** Width of each timeline bucket in milliseconds. Defaults to 5 seconds. */
  timelineBucketMs?: number;
}

export interface HpsEncounterWindow {
  id: string;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
}

interface HpsHit {
  targetId: number;
  healerActorId?: number;
  sourceId?: string;
  sourceLabel?: string;
  value: number;
  atMs: number;
}

interface IdentityInfo {
  displayName: string;
  archetype?: number;
}

const DEFAULT_CURRENT_WINDOW_MS = 5_000;
const DEFAULT_TIMELINE_BUCKET_MS = 5_000;
const UNATTRIBUTED_SOURCE_ID = "unattributed";
const UNATTRIBUTED_SOURCE_LABEL = "Unattributed healing";

/** Aggregates healing events, grouped by the identified party member casting the heal. */
export class HpsMeter {
  private readonly currentWindowMs: number;
  private readonly timelineBucketMs: number;
  private readonly identities = new Map<number, IdentityInfo>();
  private readonly hits: HpsHit[] = [];
  private personalName: string;
  private personalActorId?: number;

  constructor(options: HpsMeterOptions = {}) {
    this.currentWindowMs = options.currentWindowMs ?? DEFAULT_CURRENT_WINDOW_MS;
    this.timelineBucketMs = options.timelineBucketMs ?? DEFAULT_TIMELINE_BUCKET_MS;
    this.personalName = options.personalName ?? "";
    this.personalActorId = options.personalActorId;
  }

  consumeIdentity(event: FishNetActorIdentityEvent): void {
    if (event.operation === "reset") {
      this.identities.clear();
      return;
    }
    if (event.operation === "remove") {
      this.identities.delete(event.actorId);
      return;
    }
    this.identities.set(event.actorId, { displayName: event.displayName, archetype: event.archetype });
  }

  consumeCombat(event: FishNetCombatEvent, observedAtMs: number): void {
    if (event.kind !== "heal") return;
    if (!Number.isFinite(event.value) || event.value <= 0) return;
    this.hits.push({
      targetId: event.targetId,
      healerActorId: event.actorId,
      sourceId: event.sourceId,
      sourceLabel: event.sourceLabel,
      value: event.value,
      atMs: observedAtMs,
    });
  }

  setPersonalName(name: string): void {
    this.personalName = name;
  }

  setPersonalActorId(actorId: number | undefined): void {
    this.personalActorId = actorId;
  }

  reset(): void {
    this.hits.length = 0;
  }

  getSnapshot(window: HpsEncounterWindow, nowMs: number): MeterEncounterSnapshot {
    // Heals with no identified healer (unattributed ambient regen, or ambiguous overlapping
    // casters) can't be credited to anyone's output and are dropped, same as TPS drops hits
    // against unidentified recipients.
    const scoped = this.hits.filter((hit) =>
      hit.atMs >= window.startedAtMs
      && hit.atMs <= window.endedAtMs
      && hit.healerActorId !== undefined
      && this.identities.has(hit.healerActorId));
    const durationSeconds = Math.max(1, window.durationMs) / 1000;

    const groups = new Map<number, HpsHit[]>();
    for (const hit of scoped) {
      const healerActorId = hit.healerActorId!;
      const group = groups.get(healerActorId) ?? [];
      group.push(hit);
      groups.set(healerActorId, group);
    }

    const actors: MeterActorRow[] = [...groups.entries()].map(([healerActorId, hits]) => {
      const identity = this.identities.get(healerActorId);
      const damage = hits.reduce((sum, hit) => sum + hit.value, 0);
      const currentDamage = hits
        .filter((hit) => hit.atMs > nowMs - this.currentWindowMs && hit.atMs <= nowMs)
        .reduce((sum, hit) => sum + hit.value, 0);
      const targetsHealed = new Set(hits.map((hit) => hit.targetId));
      return {
        actorIds: [healerActorId],
        displayName: identity?.displayName ?? `Actor ${healerActorId}`,
        archetype: identity?.archetype,
        durationMs: window.durationMs,
        lastDamageAtMs: hits.reduce((max, hit) => Math.max(max, hit.atMs), window.startedAtMs),
        damage,
        dps: damage / durationSeconds,
        currentDps: currentDamage / (this.currentWindowMs / 1000),
        contribution: 0,
        hits: hits.length,
        criticalHits: 0,
        critRate: undefined,
        kills: 0,
        mobsHit: targetsHealed.size,
        skills: buildSkillRows(hits, durationSeconds),
        timeline: buildTimeline(hits, window, this.timelineBucketMs),
        isUnidentified: false,
      };
    });

    const totalDamage = actors.reduce((sum, actor) => sum + actor.damage, 0);
    for (const actor of actors) actor.contribution = totalDamage > 0 ? actor.damage / totalDamage : 0;

    const { personalMatch, personal } = resolvePersonal(actors, this.personalName, this.personalActorId);

    return {
      id: window.id,
      startedAtMs: window.startedAtMs,
      lastDamageAtMs: actors.reduce((max, actor) => Math.max(max, actor.lastDamageAtMs ?? window.startedAtMs), window.startedAtMs),
      endedAtMs: window.endedAtMs,
      durationMs: window.durationMs,
      totalDamage,
      partyDps: totalDamage / durationSeconds,
      partyCurrentDps: actors.reduce((sum, actor) => sum + actor.currentDps, 0),
      actors,
      personalName: this.personalName,
      personalMatch,
      personal,
    };
  }
}

function buildSkillRows(hits: readonly HpsHit[], durationSeconds: number): MeterSkillRow[] {
  const bySkill = new Map<string, { sourceLabel: string; damage: number; hits: number }>();
  for (const hit of hits) {
    const sourceId = hit.sourceId ?? UNATTRIBUTED_SOURCE_ID;
    const sourceLabel = hit.sourceId === undefined ? UNATTRIBUTED_SOURCE_LABEL : (hit.sourceLabel ?? hit.sourceId);
    const row = bySkill.get(sourceId) ?? { sourceLabel, damage: 0, hits: 0 };
    row.damage += hit.value;
    row.hits += 1;
    bySkill.set(sourceId, row);
  }
  const totalDamage = [...bySkill.values()].reduce((sum, row) => sum + row.damage, 0);
  return [...bySkill.entries()].map(([sourceId, row]) => ({
    sourceId,
    sourceLabel: row.sourceLabel,
    damage: row.damage,
    dps: row.damage / durationSeconds,
    contribution: totalDamage > 0 ? row.damage / totalDamage : 0,
    hits: row.hits,
    criticalHits: 0,
    critRate: undefined,
  }));
}

function buildTimeline(hits: readonly HpsHit[], window: HpsEncounterWindow, bucketMs: number): MeterTimelinePoint[] {
  if (hits.length === 0) return [];
  const lastElapsedMs = Math.max(...hits.map((hit) => hit.atMs - window.startedAtMs));
  const bucketCount = Math.max(1, Math.floor(lastElapsedMs / bucketMs) + 1);
  const buckets = new Array<number>(bucketCount).fill(0);
  for (const hit of hits) {
    const elapsedMs = Math.max(0, hit.atMs - window.startedAtMs);
    const index = Math.min(bucketCount - 1, Math.floor(elapsedMs / bucketMs));
    buckets[index] = (buckets[index] ?? 0) + hit.value;
  }
  let cumulative = 0;
  return buckets.map((damage, index) => {
    cumulative += damage;
    const elapsedMs = (index + 1) * bucketMs;
    return { elapsedMs, damage, cumulativeDamage: cumulative, dps: damage / (bucketMs / 1000) };
  });
}

function resolvePersonal(
  actors: readonly MeterActorRow[],
  personalName: string,
  personalActorId: number | undefined,
): { personalMatch: MeterPersonalMatch; personal?: MeterActorRow } {
  if (!personalName && personalActorId === undefined) return { personalMatch: "unconfigured" };
  if (personalActorId !== undefined) {
    const match = actors.find((actor) => actor.actorIds.includes(personalActorId));
    return match ? { personalMatch: "matched", personal: match } : { personalMatch: "missing" };
  }
  const needle = personalName.toLocaleLowerCase();
  const matches = actors.filter((actor) => actor.displayName.toLocaleLowerCase() === needle);
  if (matches.length === 0) return { personalMatch: "missing" };
  if (matches.length > 1) return { personalMatch: "ambiguous" };
  return { personalMatch: "matched", personal: matches[0] };
}
