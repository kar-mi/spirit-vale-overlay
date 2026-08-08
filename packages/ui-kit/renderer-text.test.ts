import { expect, test } from "bun:test";
import { repairRendererPayload, repairRendererText } from "./renderer-text.ts";

test("repairs Windows-1252 mojibake while preserving normal text", () => {
  expect(repairRendererText("USB Ã— adapter")).toBe("USB × adapter");
  expect(repairRendererText("Npcap Â· ready")).toBe("Npcap · ready");
  expect(repairRendererText("combat.jsonl · Encounter 2 ￂﾷ 2:13")).toBe("combat.jsonl · Encounter 2 · 2:13");
  expect(repairRendererText("range â€” active")).toBe("range — active");
  expect(repairRendererText("plain × · — → é Ω 中文 😀")).toBe("plain × · — → é Ω 中文 😀");
});

test("repairs nested RPC payloads without changing non-text values", () => {
  const payload = {
    adapters: [{ id: "\\Device\\NPF_1", label: "Wi-Fi Ã— 6" }],
    detail: "Npcap Â· 1.80",
    retries: 2,
    enabled: true,
  };
  expect(repairRendererPayload(payload)).toEqual({
    adapters: [{ id: "\\Device\\NPF_1", label: "Wi-Fi × 6" }],
    detail: "Npcap · 1.80",
    retries: 2,
    enabled: true,
  });
});

test("does not alter malformed or already repaired values", () => {
  expect(repairRendererText("Ã")).toBe("Ã");
  expect(repairRendererText(repairRendererText("USB Ã— adapter"))).toBe("USB × adapter");
});
