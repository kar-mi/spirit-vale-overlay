/**
 * Decodes the marker the server spawns where a world boss died.
 *
 * The gravestone is an ordinary world object, so it arrives as an `objectSpawn` whose payload ends
 * with the three strings the marker displays — who landed the kill, the boss's display name, and its
 * catalog id — preceded by the server's own time of death. That last part is what makes this worth
 * decoding at all: a death event only tells us a boss died *now* and only if we were watching, while
 * a gravestone tells us when a boss died that nobody here saw, for as long as the marker stands.
 *
 * The RPC map does not describe this object, so the layout was recovered from captures. Rather than
 * trusting the offsets that produced, the tail is located structurally: the strings must decode
 * cleanly and finish exactly at the end of the payload, and the eight bytes in front of them must
 * read as a time close to when the packet arrived. Anything else is refused. A spawn that does not
 * fit is simply not a gravestone, which is the safe outcome for every other object in the world.
 */

/** Strings the marker shows, in payload order. */
const GRAVESTONE_STRINGS = 3;
/** Nothing the marker displays is longer than this; a larger length means the offset is wrong. */
const MAX_STRING_BYTES = 64;
/**
 * How stale a gravestone's death time may be and still be believed. The marker outlives the boss's
 * 90-minute cycle, so this only rejects a reading that cannot be a time of death at all.
 */
const MAX_DEATH_AGE_MS = 6 * 60 * 60_000;
/** Slack for the server's clock running ahead of ours; a death is otherwise always in the past. */
const MAX_CLOCK_SKEW_MS = 60_000;
/**
 * Smallest tail the strings can occupy: each is a length prefix and at least one byte.
 *
 * Empty strings are refused, so an offset with less than this after it cannot begin them.
 */
const MIN_TAIL_BYTES = GRAVESTONE_STRINGS * 2;
/**
 * Largest tail they can occupy, and therefore how far back the scan below has to reach.
 *
 * The strings must finish exactly at the end of the payload, and each is a zigzag length prefix
 * followed by at most {@link MAX_STRING_BYTES} bytes — a length of 64 zigzags to 128, which needs
 * two prefix bytes rather than one. Anything earlier than this cannot be their start, which matters
 * because every other spawned object in the world is offered to this decoder too: without the bound
 * each one pays a scan across its whole payload, allocating a string at roughly every other offset
 * for nothing. A real gravestone's payload is far shorter than this, so the bound never moves where
 * the scan starts for one — it only stops the decoder wandering through everything else.
 */
const MAX_TAIL_BYTES = GRAVESTONE_STRINGS * (2 + MAX_STRING_BYTES);

export interface BossGravestone {
  /** Catalog id of the boss, e.g. `Sunflora Pixie`. The same id the timers are keyed on. */
  mobId: string;
  /** Display name of the boss, e.g. `Lady Fey`. */
  bossName: string;
  /** Player the marker credits with the kill. */
  killedBy: string;
  /** When the server says the boss died, rather than when we happened to see the marker. */
  diedAtMs: number;
}

/**
 * Reads `payload` as a gravestone, or returns undefined when it is any other spawned object.
 *
 * `nowMs` anchors the plausibility of the decoded time; pass the moment the packet was observed.
 */
export function decodeBossGravestone(payload: Buffer, nowMs: number): BossGravestone | undefined {
  // The strings sit at the tail, so every offset that could begin them is tried and the one that
  // consumes the payload exactly wins. Eight bytes have to precede it for the timestamp.
  const first = Math.max(8, payload.length - MAX_TAIL_BYTES);
  for (let offset = first; offset + MIN_TAIL_BYTES <= payload.length; offset += 1) {
    const strings = readTailStrings(payload, offset);
    if (!strings) continue;
    const diedAtMs = readDeathTime(payload, offset - 8, nowMs);
    if (diedAtMs === undefined) continue;
    const [killedBy, bossName, mobId] = strings;
    return { mobId: mobId!, bossName: bossName!, killedBy: killedBy!, diedAtMs };
  }
  return undefined;
}

/** The death time as milliseconds, or undefined when those bytes are not a believable one. */
function readDeathTime(payload: Buffer, offset: number, nowMs: number): number | undefined {
  // Seconds as a float64, which is how the server sends it; whole seconds in every capture seen.
  const diedAtMs = payload.readDoubleLE(offset) * 1_000;
  if (!Number.isFinite(diedAtMs)) return undefined;
  if (diedAtMs > nowMs + MAX_CLOCK_SKEW_MS) return undefined;
  if (diedAtMs < nowMs - MAX_DEATH_AGE_MS) return undefined;
  return diedAtMs;
}

/** The marker's strings, only if exactly {@link GRAVESTONE_STRINGS} of them end the payload. */
function readTailStrings(payload: Buffer, offset: number): string[] | undefined {
  const strings: string[] = [];
  let cursor = offset;
  for (let index = 0; index < GRAVESTONE_STRINGS; index += 1) {
    const length = readPackedLength(payload, cursor);
    if (length === undefined) return undefined;
    if (length.value <= 0 || length.value > MAX_STRING_BYTES) return undefined;
    const end = length.next + length.value;
    if (end > payload.length) return undefined;
    const text = payload.toString("utf8", length.next, end);
    // A wrong offset usually still yields bytes; requiring displayable text is what rejects those.
    if (!isDisplayable(text)) return undefined;
    strings.push(text);
    cursor = end;
  }
  return cursor === payload.length ? strings : undefined;
}

/** FishNet packs lengths as zigzag varints, the same encoding its packed ints use. */
function readPackedLength(payload: Buffer, offset: number): { value: number; next: number } | undefined {
  let raw = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < payload.length && shift <= 28) {
    const byte = payload[cursor]!;
    raw |= (byte & 0x7f) << shift;
    cursor += 1;
    if ((byte & 0x80) === 0) return { value: (raw >>> 1) ^ -(raw & 1), next: cursor };
    shift += 7;
  }
  return undefined;
}

function isDisplayable(text: string): boolean {
  if (text.length === 0) return false;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    // Control characters never appear in a name the game renders, and their presence is the
    // clearest sign these bytes are something else read at the wrong offset.
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}
