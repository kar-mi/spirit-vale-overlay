import { parseDpsLogRecord } from "@kar-mi/spirit-vale-tools-combat";
import type { FishNetDpsEncounterSnapshot } from "@kar-mi/spirit-vale-tools-combat";
import { parseLogRecord } from "@kar-mi/spirit-vale-tools-logging";

import { parseMobIdentityEvent, readLines, replayTime } from "./death-log.ts";
import { HpsMeter } from "./hps-meter.ts";
import type { MeterEncounterSnapshot } from "./app-types.ts";

export interface HpsReplayResult {
  /** One entry per input snapshot, same order/ids, for zip-by-index or Map-by-id lookup. */
  snapshots: MeterEncounterSnapshot[];
  invalidLines: number;
}

/** Re-parses a combat JSONL replay to build per-encounter healing snapshots. */
export async function loadHpsReplay(filePath: string, dpsSnapshots: readonly FishNetDpsEncounterSnapshot[]): Promise<HpsReplayResult> {
  const meter = new HpsMeter();
  let invalidLines = 0;
  let originTick: number | undefined;
  let recordedAtOriginMs: number | undefined;
  const snapshots: MeterEncounterSnapshot[] = new Array(dpsSnapshots.length);
  const pendingSnapshots = dpsSnapshots
    // The DPS meter closes an encounter after an inactivity timeout. Identity reset/removal
    // records often arrive during that timeout, so preserve the identity state at its final
    // damaging event rather than at the later display end time.
    .map((snapshot, index) => ({ snapshot, index, identityAtMs: snapshot.lastDamageAtMs }))
    .sort((left, right) => left.identityAtMs - right.identityAtMs);
  let nextSnapshotIndex = 0;

  const captureCompletedSnapshots = (beforeMs: number): void => {
    while (nextSnapshotIndex < pendingSnapshots.length && pendingSnapshots[nextSnapshotIndex]!.identityAtMs < beforeMs) {
      const { snapshot, index } = pendingSnapshots[nextSnapshotIndex++]!;
      const endedAtMs = snapshot.endedAtMs ?? snapshot.lastDamageAtMs;
      snapshots[index] = meter.getSnapshot({
        id: snapshot.id,
        startedAtMs: snapshot.startedAtMs,
        endedAtMs,
        durationMs: snapshot.durationMs,
      }, endedAtMs);
    }
  };

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
    if (parseMobIdentityEvent(record.type, record.data)) continue;
    const event = parseDpsLogRecord(record.type, record.data);
    if (event === null) continue;
    if (!event) {
      invalidLines += 1;
      continue;
    }
    const atMs = replayTime(event.tick, record.recordedAt, () => originTick, (value) => { originTick = value; }, () => recordedAtOriginMs, (value) => { recordedAtOriginMs = value; });
    // Snapshot before applying a later record, so identity removals/resets after an
    // encounter cannot erase the names needed to render that encounter's HPS.
    captureCompletedSnapshots(atMs);
    if (event.kind === "actorIdentity") {
      meter.consumeIdentity(event);
      continue;
    }
    meter.consumeCombat(event, atMs);
  }

  captureCompletedSnapshots(Number.POSITIVE_INFINITY);
  return { snapshots, invalidLines };
}
