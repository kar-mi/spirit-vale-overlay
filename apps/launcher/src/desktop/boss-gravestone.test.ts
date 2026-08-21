import { describe, expect, test } from "bun:test";

import { decodeBossGravestone } from "./boss-gravestone.ts";

/**
 * Builds a gravestone payload in the layout captures showed: a fixed 36-byte header, the time of
 * death as float64 seconds, then the three strings the marker displays.
 *
 * Synthesized rather than pasted from a capture on purpose — a real payload carries the names of
 * real players, and this repository is public.
 */
function gravestonePayload(options: {
  diedAtMs: number;
  killedBy: string;
  bossName: string;
  mobId: string;
  headerBytes?: number;
}): Buffer {
  const header = Buffer.alloc(options.headerBytes ?? 36);
  // Roughly what the real header holds: flags, then the marker's world position.
  header.writeFloatLE(583.74, 10);
  header.writeFloatLE(76.37, 14);
  header.writeFloatLE(681.99, 18);
  const died = Buffer.alloc(8);
  died.writeDoubleLE(options.diedAtMs / 1_000, 0);
  const strings = [options.killedBy, options.bossName, options.mobId].map((text) => {
    const bytes = Buffer.from(text, "utf8");
    return Buffer.concat([packedLength(bytes.length), bytes]);
  });
  return Buffer.concat([header, died, ...strings]);
}

/** Zigzag varint, the encoding FishNet uses for a string's length prefix. */
function packedLength(value: number): Buffer {
  let raw = (value << 1) ^ (value >> 31);
  const bytes: number[] = [];
  do {
    let byte = raw & 0x7f;
    raw >>>= 7;
    if (raw !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (raw !== 0);
  return Buffer.from(bytes);
}

describe("boss gravestone", () => {
  const nowMs = 1_787_247_972_751;
  // 51 minutes before the marker was seen, as in the capture this was recovered from.
  const diedAtMs = nowMs - 51 * 60_000 - 18_000;

  test("reads the killer, the boss, its catalog id and the server's time of death", () => {
    const payload = gravestonePayload({
      diedAtMs,
      killedBy: "Testerson",
      bossName: "Lady Fey",
      mobId: "Sunflora Pixie",
    });

    expect(decodeBossGravestone(payload, nowMs)).toEqual({
      killedBy: "Testerson",
      bossName: "Lady Fey",
      mobId: "Sunflora Pixie",
      diedAtMs,
    });
  });

  test("finds the fields whatever the names are long, since they end the payload", () => {
    for (const killedBy of ["A", "Testerson", "A Rather Long Character Name"]) {
      const decoded = decodeBossGravestone(
        gravestonePayload({ diedAtMs, killedBy, bossName: "Orc King", mobId: "Goblin Giant Gold" }),
        nowMs,
      );
      expect(decoded).toMatchObject({ killedBy, bossName: "Orc King", mobId: "Goblin Giant Gold" });
    }
  });

  test("does not depend on the header staying the size it is today", () => {
    const decoded = decodeBossGravestone(
      gravestonePayload({ diedAtMs, killedBy: "Testerson", bossName: "Naga", mobId: "Snake Naga", headerBytes: 44 }),
      nowMs,
    );
    expect(decoded).toMatchObject({ bossName: "Naga", diedAtMs });
  });

  test("still finds the tail behind a header far larger than any real one", () => {
    // The scan only reaches back as far as the strings could possibly begin, so a header that grows
    // must not push them out of range. Longest fields the marker can hold, behind 4KB of header.
    const decoded = decodeBossGravestone(
      gravestonePayload({
        diedAtMs,
        killedBy: "A".repeat(64),
        bossName: "B".repeat(64),
        mobId: "C".repeat(64),
        headerBytes: 4_096,
      }),
      nowMs,
    );
    expect(decoded).toMatchObject({ killedBy: "A".repeat(64), mobId: "C".repeat(64), diedAtMs });
  });

  test("refuses anything that is not a gravestone", () => {
    // Every other spawned object in the world reaches this decoder, so a confident wrong answer
    // would invent timers. Refusing is the only safe failure.
    expect(decodeBossGravestone(Buffer.alloc(0), nowMs)).toBeUndefined();
    expect(decodeBossGravestone(Buffer.alloc(64), nowMs)).toBeUndefined();
    expect(decodeBossGravestone(Buffer.from("00112233445566778899aabbccddeeff", "hex"), nowMs)).toBeUndefined();
    // Trailing bytes after the strings mean these are not the payload's tail.
    const trailing = Buffer.concat([
      gravestonePayload({ diedAtMs, killedBy: "Testerson", bossName: "Naga", mobId: "Snake Naga" }),
      Buffer.from([0x01, 0x02]),
    ]);
    expect(decodeBossGravestone(trailing, nowMs)).toBeUndefined();
  });

  test("refuses a time of death that cannot belong to this sighting", () => {
    const future = gravestonePayload({
      diedAtMs: nowMs + 10 * 60_000,
      killedBy: "Testerson",
      bossName: "Naga",
      mobId: "Snake Naga",
    });
    expect(decodeBossGravestone(future, nowMs)).toBeUndefined();

    const ancient = gravestonePayload({
      diedAtMs: nowMs - 12 * 60 * 60_000,
      killedBy: "Testerson",
      bossName: "Naga",
      mobId: "Snake Naga",
    });
    expect(decodeBossGravestone(ancient, nowMs)).toBeUndefined();
  });
});
