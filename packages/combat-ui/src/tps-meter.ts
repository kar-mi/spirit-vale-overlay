import type { FishNetActorIdentityEvent, FishNetCombatEvent, FishNetHitResult } from "@kar-mi/spirit-vale-tools-combat";
import type { MeterActorRow, MeterEncounterSnapshot, MeterPersonalMatch, MeterSkillRow, MeterTimelinePoint } from "./app-types.ts";
import { normalizePlayerName } from "./player-name.ts";

export interface TpsMeterOptions {
  personalName?: string;
  personalActorId?: number;
  /** Milliseconds of recent damage included in current TPS. Defaults to 5 seconds. */
  currentWindowMs?: number;
  /** Width of each timeline bucket in milliseconds. Defaults to 5 seconds. */
  timelineBucketMs?: number;
}

export interface TpsEncounterWindow {
  id: string;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
}

interface TpsHit {
  targetId: number;
  targetIdentity?: IdentityInfo;
  sourceActorId: number;
  sourceId: string;
  sourceLabel: string;
  value: number;
  hitResult: FishNetHitResult;
  atMs: number;
}

interface IdentityInfo {
  displayName: string;
  archetype?: number;
}

const DEFAULT_CURRENT_WINDOW_MS = 5_000;
const DEFAULT_TIMELINE_BUCKET_MS = 5_000;

/** Aggregates incoming (tanked) damage events, grouped by the party member taking the hit. */
export class TpsMeter {
  private readonly currentWindowMs: number;
  private readonly timelineBucketMs: number;
  private readonly identities = new Map<number, IdentityInfo>();
  private readonly hits: TpsHit[] = [];
  private personalName: string;
  private personalActorId?: number;

  constructor(options: TpsMeterOptions = {}) {
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
    if (event.kind !== "damage" && event.kind !== "death") return;
    if (event.team === 0) return;
    if (event.actorId === event.targetId) return;
    if (!Number.isFinite(event.value) || event.value <= 0) return;
    if (event.kind === "death" && event.duplicatesDamageEvent) return;
    const targetIdentity = this.identities.get(event.targetId);
    this.hits.push({
      targetId: event.targetId,
      ...(targetIdentity === undefined ? {} : { targetIdentity: { ...targetIdentity } }),
      sourceActorId: event.actorId,
      sourceId: event.sourceId,
      sourceLabel: event.sourceLabel,
      value: event.value,
      hitResult: event.hitResult,
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

  getSnapshot(window: TpsEncounterWindow, nowMs: number): MeterEncounterSnapshot {
    const scoped = this.hits.filter((hit) => hit.atMs >= window.startedAtMs && hit.atMs <= window.endedAtMs);
    const durationSeconds = Math.max(1, window.durationMs) / 1000;

    const groups = new Map<string, { targetIds: Set<number>; hits: TpsHit[] }>();
    for (const hit of scoped) {
      const identity = hit.targetIdentity;
      const key = identity ? `name:${normalizePlayerName(identity.displayName)}` : `id:${hit.targetId}`;
      const group = groups.get(key) ?? { targetIds: new Set<number>(), hits: [] };
      group.targetIds.add(hit.targetId);
      group.hits.push(hit);
      groups.set(key, group);
    }

    const actors: MeterActorRow[] = [...groups.values()].map((group) => {
      const identity = group.hits[0]?.targetIdentity;
      const damage = group.hits.reduce((sum, hit) => sum + hit.value, 0);
      const hits = group.hits.length;
      const criticalHits = group.hits.filter((hit) => hit.hitResult === "critical").length;
      const currentDamage = group.hits
        .filter((hit) => hit.atMs > nowMs - this.currentWindowMs && hit.atMs <= nowMs)
        .reduce((sum, hit) => sum + hit.value, 0);
      return {
        actorIds: [...group.targetIds],
        displayName: identity?.displayName ?? "Unidentified",
        archetype: identity?.archetype,
        durationMs: window.durationMs,
        lastDamageAtMs: group.hits.reduce((max, hit) => Math.max(max, hit.atMs), window.startedAtMs),
        damage,
        dps: damage / durationSeconds,
        currentDps: currentDamage / (this.currentWindowMs / 1000),
        contribution: 0,
        hits,
        criticalHits,
        critRate: hits > 0 ? criticalHits / hits : undefined,
        kills: 0,
        mobsHit: new Set(group.hits.map((hit) => hit.sourceActorId)).size,
        skills: buildSkillRows(group.hits, durationSeconds),
        timeline: buildTimeline(group.hits, window, this.timelineBucketMs),
        isUnidentified: identity === undefined,
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

function buildSkillRows(hits: readonly TpsHit[], durationSeconds: number): MeterSkillRow[] {
  const bySkill = new Map<string, { sourceLabel: string; damage: number; hits: number; criticalHits: number }>();
  for (const hit of hits) {
    const row = bySkill.get(hit.sourceId) ?? { sourceLabel: hit.sourceLabel, damage: 0, hits: 0, criticalHits: 0 };
    row.damage += hit.value;
    row.hits += 1;
    if (hit.hitResult === "critical") row.criticalHits += 1;
    bySkill.set(hit.sourceId, row);
  }
  const totalDamage = [...bySkill.values()].reduce((sum, row) => sum + row.damage, 0);
  return [...bySkill.entries()].map(([sourceId, row]) => ({
    sourceId,
    sourceLabel: row.sourceLabel,
    damage: row.damage,
    dps: row.damage / durationSeconds,
    contribution: totalDamage > 0 ? row.damage / totalDamage : 0,
    hits: row.hits,
    criticalHits: row.criticalHits,
    critRate: row.hits > 0 ? row.criticalHits / row.hits : undefined,
  }));
}

function buildTimeline(hits: readonly TpsHit[], window: TpsEncounterWindow, bucketMs: number): MeterTimelinePoint[] {
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
  const needle = normalizePlayerName(personalName);
  const matches = actors.filter((actor) => normalizePlayerName(actor.displayName) === needle);
  if (matches.length === 0) return { personalMatch: "missing" };
  if (matches.length > 1) return { personalMatch: "ambiguous" };
  return { personalMatch: "matched", personal: matches[0] };
}
