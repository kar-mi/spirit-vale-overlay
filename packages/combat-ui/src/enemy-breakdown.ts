import { parseDpsLogRecord } from "@kar-mi/spirit-vale-tools-combat";
import type { FishNetDpsEncounterSnapshot } from "@kar-mi/spirit-vale-tools-combat";
import { parseLogRecord } from "@kar-mi/spirit-vale-tools-logging";

import { isPositiveHit, parseMobIdentityEvent, readLines, replayTime } from "./death-log.ts";

export interface EnemyOption {
  targetId: number;
  label: string;
}

export interface EnemySkillStats {
  sourceLabel: string;
  damage: number;
  hits: number;
  criticalHits: number;
}

export interface EnemyDamageRow {
  targetId: number;
  damage: number;
  hits: number;
  criticalHits: number;
}

export interface EnemyBreakdownEncounter {
  encounterId: string;
  enemies: EnemyOption[];
  /** actorId (attacker) -> targetId (enemy) -> sourceId (skill) -> accumulated stats. */
  bySkill: Map<number, Map<number, Map<string, EnemySkillStats>>>;
}

export interface EnemyBreakdownReplay {
  encounters: EnemyBreakdownEncounter[];
  invalidLines: number;
}

interface EncounterWindow {
  encounterId: string;
  startedAtMs: number;
  endAtMs: number;
}

/** Re-parses a combat JSONL replay to build per-attacker, per-enemy, per-skill damage aggregates. */
export async function loadEnemyBreakdown(filePath: string, snapshots: readonly FishNetDpsEncounterSnapshot[]): Promise<EnemyBreakdownReplay> {
  const windows: EncounterWindow[] = snapshots.map((snapshot) => ({
    encounterId: snapshot.id,
    startedAtMs: snapshot.startedAtMs,
    endAtMs: snapshot.endedAtMs ?? snapshot.lastDamageAtMs,
  }));

  const mobIdentities = new Map<number, string>();
  const firstSeenAtMs = new Map<number, number>();
  const bySkillByEncounter = new Map<string, Map<number, Map<number, Map<string, EnemySkillStats>>>>();
  for (const window of windows) bySkillByEncounter.set(window.encounterId, new Map());

  let invalidLines = 0;
  let originTick: number | undefined;
  let recordedAtOriginMs: number | undefined;

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
    if (event.kind !== "damage" && event.kind !== "death") continue;
    if (!isPositiveHit(event)) continue;
    const window = windows.find((candidateWindow) => atMs >= candidateWindow.startedAtMs && atMs <= candidateWindow.endAtMs);
    if (!window) continue;

    if (!firstSeenAtMs.has(event.targetId)) firstSeenAtMs.set(event.targetId, atMs);

    const byActor = bySkillByEncounter.get(window.encounterId)!;
    const byTarget = byActor.get(event.actorId) ?? new Map<number, Map<string, EnemySkillStats>>();
    byActor.set(event.actorId, byTarget);
    const bySkill = byTarget.get(event.targetId) ?? new Map<string, EnemySkillStats>();
    byTarget.set(event.targetId, bySkill);
    const stats = bySkill.get(event.sourceId) ?? { sourceLabel: event.sourceLabel, damage: 0, hits: 0, criticalHits: 0 };
    stats.damage += event.value;
    stats.hits += 1;
    if (event.hitResult === "critical") stats.criticalHits += 1;
    bySkill.set(event.sourceId, stats);
  }

  const encounters: EnemyBreakdownEncounter[] = windows.map((window) => {
    const byActor = bySkillByEncounter.get(window.encounterId)!;
    const targetIds = new Set<number>();
    for (const byTarget of byActor.values()) {
      for (const targetId of byTarget.keys()) targetIds.add(targetId);
    }
    const enemies = buildEnemyOptions(targetIds, mobIdentities, firstSeenAtMs);
    return { encounterId: window.encounterId, enemies, bySkill: byActor };
  });

  return { encounters, invalidLines };
}

function buildEnemyOptions(targetIds: Set<number>, mobIdentities: Map<number, string>, firstSeenAtMs: Map<number, number>): EnemyOption[] {
  const ordered = [...targetIds].sort((left, right) => (firstSeenAtMs.get(left) ?? 0) - (firstSeenAtMs.get(right) ?? 0));
  const rawNames = new Map<number, string>(ordered.map((targetId) => [targetId, mobIdentities.get(targetId) ?? `Enemy ${targetId}`]));
  const nameCounts = new Map<string, number>();
  for (const name of rawNames.values()) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  const nextIndex = new Map<string, number>();
  return ordered.map((targetId) => {
    const name = rawNames.get(targetId)!;
    if ((nameCounts.get(name) ?? 0) <= 1) return { targetId, label: name };
    const index = (nextIndex.get(name) ?? 0) + 1;
    nextIndex.set(name, index);
    return { targetId, label: `${name} (${index})` };
  });
}
