/**
 * Repairs text that a Windows native renderer has decoded as Windows-1252
 * after it was sent as UTF-8. This is intentionally conservative: a value is
 * changed only when it contains a common mojibake lead sequence and the
 * reverse conversion is valid UTF-8.
 * 
 * TODO - this is an electro bun artifact. if we swap frameworks, won't need this anymore
 */
const WINDOWS_1252_BYTES = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

const MOJIBAKE_LEAD = /(?:\u00c2[\u0080-\u00ff\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018-\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178]|\u00c3[\u0080-\u00ff\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018-\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178]|\u00e2[\u0080-\u00ff\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018-\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178])/u;
const HALFWIDTH_UTF8_SEQUENCE = /[\uffc2\uffc3\uffe2][\uff80-\uffbf]+/gu;
const utf8 = new TextDecoder("utf-8", { fatal: true });

/** Repairs one or more layers of UTF-8 decoded as Windows-1252. */
export function repairRendererText(value: string): string {
  let repaired = repairHalfwidthUtf8(value);
  for (let attempt = 0; attempt < 3 && MOJIBAKE_LEAD.test(repaired); attempt += 1) {
    const bytes = windows1252Bytes(repaired);
    if (!bytes) break;
    try {
      const next = utf8.decode(bytes);
      if (next === repaired) break;
      repaired = next;
    } catch {
      break;
    }
  }
  return repaired;
}

function repairHalfwidthUtf8(value: string): string {
  return value.replace(HALFWIDTH_UTF8_SEQUENCE, (sequence) => {
    const bytes = Uint8Array.from(sequence, (character) => character.codePointAt(0)! & 0xff);
    try {
      return utf8.decode(bytes);
    } catch {
      return sequence;
    }
  });
}

/** Repairs every string in an RPC payload before it is rendered. */
export function repairRendererPayload<T>(value: T): T {
  if (typeof value === "string") return repairRendererText(value) as T;
  if (Array.isArray(value)) return value.map(repairRendererPayload) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, repairRendererPayload(entry)])) as T;
  }
  return value;
}

function windows1252Bytes(value: string): Uint8Array | undefined {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    const mapped = WINDOWS_1252_BYTES.get(codePoint);
    if (mapped !== undefined) bytes[index] = mapped;
    else if (codePoint <= 0xff) bytes[index] = codePoint;
    else return undefined;
  }
  return bytes;
}
