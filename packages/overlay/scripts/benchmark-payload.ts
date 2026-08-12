import { DpsLogFollower, LiveCombatService } from "@kar-mi/spirit-vale-tools-combat";

import { overlayMeterState } from "../src/meter-presentation.ts";

const logPath = process.argv[2];
if (!logPath) {
  console.error("Usage: bun packages/overlay/scripts/benchmark-payload.ts <combat.jsonl> [personal name]");
  process.exit(1);
}

const personalName = process.argv[3] ?? "";
const follower = new DpsLogFollower(logPath);
const meter = new LiveCombatService({ personalName, timelinePoints: 720 });
const batch = await follower.poll();
let nowMs = 0;
for (const { event, observedAtMs } of batch.events) {
  if (event.kind === "actorIdentity") meter.consumeIdentity(event, observedAtMs);
  else meter.consumeCombat(event, observedAtMs);
  nowMs = Math.max(nowMs, observedAtMs);
}
meter.advance(nowMs);

const live = meter.getState(nowMs);
const record = live.current ?? live.latestFinished;
if (!record) {
  console.error("The log did not produce a combat encounter.");
  process.exit(1);
}

const legacy = {
  snapshot: record.dps,
  tankedSnapshot: record.tps.detail,
  healSnapshot: record.hps.detail,
};
const compact = overlayMeterState(record, "damage", nowMs, "encounter");
const iterations = 100;

console.table({
  legacy: measure(legacy, iterations),
  compact: measure(compact, iterations),
});
console.log(`events=${batch.events.length.toLocaleString()} actors=${record.dps.actors.length}`);

function measure(value: unknown, count: number): { bytes: number; stringifyMs: string; parseMs: string } {
  const json = JSON.stringify(value);
  const stringifyStarted = performance.now();
  for (let index = 0; index < count; index += 1) JSON.stringify(value);
  const stringifyMs = (performance.now() - stringifyStarted) / count;
  const parseStarted = performance.now();
  for (let index = 0; index < count; index += 1) JSON.parse(json);
  const parseMs = (performance.now() - parseStarted) / count;
  return {
    bytes: Buffer.byteLength(json),
    stringifyMs: stringifyMs.toFixed(3),
    parseMs: parseMs.toFixed(3),
  };
}
