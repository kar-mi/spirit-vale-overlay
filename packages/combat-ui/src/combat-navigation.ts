import type { CombatLogScreen, DpsAppState } from "./app-types.ts";

export type ActiveDeathLogSource = "live" | "past";

export function activeDeathLogSource(
  screen: CombatLogScreen,
  pastView: DpsAppState["past"]["view"],
  liveAvailable: boolean,
): ActiveDeathLogSource | undefined {
  if (screen === "live") return liveAvailable ? "live" : undefined;
  return pastView === "analysis" ? "past" : undefined;
}
