export type MeterStatType = "damage" | "tanked" | "heal";

export interface MeterLabels {
  rate: "DPS" | "TPS" | "HPS";
  amount: "Damage" | "Damage taken" | "Healing";
  shortAmount: "DMG" | "HEAL";
}

export function meterLabels(statType: MeterStatType): MeterLabels {
  if (statType === "tanked") return { rate: "TPS", amount: "Damage taken", shortAmount: "DMG" };
  if (statType === "heal") return { rate: "HPS", amount: "Healing", shortAmount: "HEAL" };
  return { rate: "DPS", amount: "Damage", shortAmount: "DMG" };
}
