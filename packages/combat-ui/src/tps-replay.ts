import { parseDpsLogRecord } from "@kar-mi/spirit-vale-tools-combat";
import type { FishNetDpsEncounterSnapshot } from "@kar-mi/spirit-vale-tools-combat";
import { parseLogRecord } from "@kar-mi/spirit-vale-tools-logging";

import { parseMobIdentityEvent, readLines, replayTime } from "./death-log.ts";
import { TpsMeter } from "./tps-meter.ts";
import type { MeterEncounterSnapshot } from "./app-types.ts";

export interface TpsReplayResult {
  /** One entry per input snapshot, same order/ids, for zip-by-index or Map-by-id lookup. */
  snapshots: MeterEncounterSnapshot[];
  invalidLines: number;
}

/** Re-parses a combat JSONL replay to build per-encounter tanked-damage snapshots. */
export async function loadTpsReplay(filePath: string, dpsSnapshots: readonly FishNetDpsEncounterSnapshot[]): Promise<TpsReplayResult> {
  const meter = new TpsMeter();
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
    if (parseMobIdentityEvent(record.type, record.data)) continue;
    const event = parseDpsLogRecord(record.type, record.data);
    if (event === null) continue;
    if (!event) {
      invalidLines += 1;
      continue;
    }
    const atMs = replayTime(event.tick, record.recordedAt, () => originTick, (value) => { originTick = value; }, () => recordedAtOriginMs, (value) => { recordedAtOriginMs = value; });
    if (event.kind === "actorIdentity") {
      meter.consumeIdentity(event);
      continue;
    }
    meter.consumeCombat(event, atMs);
  }

  const snapshots = dpsSnapshots.map((snapshot) =>
    meter.getSnapshot(
      {
        id: snapshot.id,
        startedAtMs: snapshot.startedAtMs,
        endedAtMs: snapshot.endedAtMs ?? snapshot.lastDamageAtMs,
        durationMs: snapshot.durationMs,
      },
      snapshot.endedAtMs ?? snapshot.lastDamageAtMs,
    ));
  return { snapshots, invalidLines };
}
