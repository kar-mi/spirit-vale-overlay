import { expect, test } from "bun:test";
import { repairRendererPayload, repairRendererText } from "./renderer-text.ts";

const WINDOWS_1252_CHARACTERS = new Map<number, number>([
  [0x80, 0x20ac], [0x82, 0x201a], [0x83, 0x0192], [0x84, 0x201e],
  [0x85, 0x2026], [0x86, 0x2020], [0x87, 0x2021], [0x88, 0x02c6],
  [0x89, 0x2030], [0x8a, 0x0160], [0x8b, 0x2039], [0x8c, 0x0152],
  [0x8e, 0x017d], [0x91, 0x2018], [0x92, 0x2019], [0x93, 0x201c],
  [0x94, 0x201d], [0x95, 0x2022], [0x96, 0x2013], [0x97, 0x2014],
  [0x98, 0x02dc], [0x99, 0x2122], [0x9a, 0x0161], [0x9b, 0x203a],
  [0x9c, 0x0153], [0x9e, 0x017e], [0x9f, 0x0178],
]);

function mojibake(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) => String.fromCharCode(WINDOWS_1252_CHARACTERS.get(byte) ?? byte)).join("");
}

function halfwidthMojibake(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) => (byte < 0x80 ? String.fromCharCode(byte) : String.fromCharCode(0xff00 + byte))).join("");
}

const NAMES = ["김철수", "한국인.1234", "中文玩家", "日本語ナマエ", "Игрок", "Ωμέγα", "José", "Müller", "Ñandú", "Ægir Þórr", "😀Emoji", "Ünïcödé 中文"];

test("repairs Windows-1252 mojibake while preserving normal text", () => {
  expect(repairRendererText("USB Ã— adapter")).toBe("USB × adapter");
  expect(repairRendererText("Npcap Â· ready")).toBe("Npcap · ready");
  expect(repairRendererText("combat.jsonl · Encounter 2 ￂﾷ 2:13")).toBe("combat.jsonl · Encounter 2 · 2:13");
  expect(repairRendererText("range â€” active")).toBe("range — active");
  expect(repairRendererText("plain × · — → é Ω 中文 😀")).toBe("plain × · — → é Ω 中文 😀");
});

test("repairs player names in every script, not just Latin-1", () => {
  for (const name of NAMES) expect(repairRendererText(mojibake(name))).toBe(name);
});

test("repairs the halfwidth-forms variant in every script", () => {
  for (const name of NAMES) expect(repairRendererText(halfwidthMojibake(name))).toBe(name);
});

test("leaves already-correct non-Latin text untouched", () => {
  for (const name of [...NAMES, "Ça va", "Œuvre", "Núñez", "Ötzi Ähre", "ÐÐ"]) {
    expect(repairRendererText(name)).toBe(name);
    expect(repairRendererText(repairRendererText(name))).toBe(name);
  }
});

test("repairs nested RPC payloads without changing non-text values", () => {
  const payload = {
    adapters: [{ id: "\Device\NPF_1", label: "Wi-Fi Ã— 6" }],
    detail: "Npcap Â· 1.80",
    retries: 2,
    enabled: true,
  };
  expect(repairRendererPayload(payload)).toEqual({
    adapters: [{ id: "\Device\NPF_1", label: "Wi-Fi × 6" }],
    detail: "Npcap · 1.80",
    retries: 2,
    enabled: true,
  });
});

test("does not alter malformed or already repaired values", () => {
  expect(repairRendererText("Ã")).toBe("Ã");
  expect(repairRendererText(repairRendererText("USB Ã— adapter"))).toBe("USB × adapter");
});
