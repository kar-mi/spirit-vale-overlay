import { expect, test } from "bun:test";
import { meterLabels } from "./meter-labels.ts";

test("meterLabels keeps rate and amount terminology aligned", () => {
  expect(meterLabels("damage")).toEqual({ rate: "DPS", amount: "Damage", shortAmount: "DMG" });
  expect(meterLabels("tanked")).toEqual({ rate: "TPS", amount: "Damage taken", shortAmount: "DMG" });
  expect(meterLabels("heal")).toEqual({ rate: "HPS", amount: "Healing", shortAmount: "HEAL" });
});
