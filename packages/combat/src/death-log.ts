import { parseDpsLogRecord } from "@kar-mi/spirit-vale-tools-combat";
import type { FishNetActorIdentityEvent, FishNetCombatDamageEvent, FishNetCombatDeathEvent } from "@kar-mi/spirit-vale-tools-combat";
import { isRecord, parseLogRecord } from "@kar-mi/spirit-vale-tools-logging";

const DEATH_LOOKBACK_MS = 10_000;
const REPLAY_TICKS_PER_SECOND = 30;
const MOB_IDENTITY_PREFIX = "__spiritvaleMobIdentity:";

export interface DeathLogHit {
  id: string;
  beforeDeathMs: number;
  attackerActorId: number;
  sourceLabel: string;
  attackerLabel: string;
  attackerIsMonster: boolean;
  damage: number;
  critical: boolean;
}

export interface DeathLogEntry {
  id: string;
  victimName: string;
  targetId: number;
  diedAtMs: number;
  totalDamage: number;
  hits: readonly DeathLogHit[];
}

export interface DeathLogReplay {
  deaths: readonly DeathLogEntry[];
  invalidLines: number;
}

export function selectionAfterDeathLogRefresh(
  previousSelection: string | undefined,
  deaths: readonly { id: string }[],
): string | undefined {
  return previousSelection && deaths.some((death) => death.id === previousSelection)
    ? previousSelection
    : deaths[0]?.id;
}

interface TimedHit {
  event: FishNetCombatDamageEvent | FishNetCombatDeathEvent;
  atMs: number;
}

export async function loadDeathLogReplay(filePath: string): Promise<DeathLogReplay> {
  const identities = new Map<number, string>();
  const mobIdentities = new Map<number, string>();
  const hitsByTarget = new Map<number, TimedHit[]>();
  const deaths: DeathLogEntry[] = [];
  let invalidLines = 0;
  let originTick: number | undefined;
  let recordedAtOriginMs: number | undefined;
  let nextId = 1;

  for await (const line of readLines(Bun.file(filePath).stream())) {
    if (!line.trim()) continue;
    let candidate: unknown;
    try {
      candidate = JSON.parse(line);
    } catch {
      invalidLines += 1;
      continue;
    }
    const record = parseLogRecord(candidate);
    if (!record) {
      invalidLines += 1;
      continue;
    }
    const mobIdentity = parseMobIdentityEvent(record.type, record.data);
    if (mobIdentity) {
      mobIdentities.set(mobIdentity.actorId, mobIdentity.displayName);
      continue;
    }
    const event = parseDpsLogRecord(record.type, record.data);
    if (event === null) continue;
    if (!event) {
      invalidLines += 1;
      continue;
    }
    const atMs = replayTime(event.tick, record.recordedAt, () => originTick, (value) => { originTick = value; }, () => recordedAtOriginMs, (value) => { recordedAtOriginMs = value; });
    if (event.kind === "actorIdentity") {
      consumeIdentity(identities, mobIdentities, event);
      continue;
    }
    if (event.kind !== "damage" && event.kind !== "death") continue;
    if (isPositiveHit(event)) {
      const targetHits = hitsByTarget.get(event.targetId) ?? [];
      targetHits.push({ event, atMs });
      hitsByTarget.set(event.targetId, targetHits);
    }
    if (event.kind !== "death" || event.team === 0) continue;
    const windowStart = atMs - DEATH_LOOKBACK_MS;
    const victimHits = (hitsByTarget.get(event.targetId) ?? [])
      .filter((hit) => hit.atMs >= windowStart && hit.atMs <= atMs)
      .map((hit, index): DeathLogHit => ({
        id: `${nextId}-${index}`,
        beforeDeathMs: Math.max(0, atMs - hit.atMs),
        sourceLabel: hit.event.sourceLabel,
        attackerActorId: hit.event.actorId,
        attackerLabel: identities.get(hit.event.actorId) ?? mobIdentities.get(hit.event.actorId) ?? `Actor ${hit.event.actorId}`,
        attackerIsMonster: mobIdentities.has(hit.event.actorId),
        damage: hit.event.value,
        critical: hit.event.hitResult === "critical",
      }))
      .sort((left, right) => right.beforeDeathMs - left.beforeDeathMs);
    deaths.push({
      id: `death-${nextId++}`,
      victimName: identities.get(event.targetId) ?? "Unidentified player",
      targetId: event.targetId,
      diedAtMs: atMs,
      totalDamage: victimHits.reduce((total, hit) => total + hit.damage, 0),
      hits: victimHits,
    });
  }
  return { deaths: deaths.reverse(), invalidLines };
}

function parseMobIdentityEvent(type: string, data: Record<string, unknown>): { actorId: number; displayName: string } | undefined {
  if (type !== "combat.event" || !isRecord(data) || data["kind"] !== "activation") return undefined;
  if (!isFiniteNumber(data["actorId"]) || typeof data["sourceId"] !== "string" || typeof data["sourceLabel"] !== "string") return undefined;
  if (!data["sourceId"].startsWith(MOB_IDENTITY_PREFIX)) return undefined;
  return { actorId: data["actorId"], displayName: data["sourceLabel"] };
}

function consumeIdentity(identities: Map<number, string>, mobIdentities: Map<number, string>, event: FishNetActorIdentityEvent): void {
  if (event.operation === "reset") {
    identities.clear();
    mobIdentities.clear();
  }
  else if (event.operation === "remove") identities.delete(event.actorId);
  else identities.set(event.actorId, event.displayName);
}

function isPositiveHit(event: FishNetCombatDamageEvent | FishNetCombatDeathEvent): boolean {
  return event.value > 0 && (event.kind === "damage" || !event.duplicatesDamageEvent);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function replayTime(
  tick: number,
  recordedAt: string,
  getOriginTick: () => number | undefined,
  setOriginTick: (value: number) => void,
  getRecordedAtOriginMs: () => number | undefined,
  setRecordedAtOriginMs: (value: number) => void,
): number {
  const recordedAtMs = Date.parse(recordedAt);
  if (Number.isFinite(recordedAtMs)) {
    const origin = getRecordedAtOriginMs();
    if (origin === undefined) {
      setRecordedAtOriginMs(recordedAtMs);
      return 0;
    }
    return recordedAtMs - origin;
  }
  const origin = getOriginTick();
  if (origin === undefined) {
    setOriginTick(tick);
    return 0;
  }
  return ((tick - origin) * 1_000) / REPLAY_TICKS_PER_SECOND;
}

async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      yield* lines;
    }
    pending += decoder.decode();
    if (pending) yield pending;
  } finally {
    reader.releaseLock();
  }
}
