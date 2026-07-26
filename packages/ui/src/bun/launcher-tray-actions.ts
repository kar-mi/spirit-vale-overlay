export type LauncherMinimizeAction = "hide" | "minimize";
export type TrayAction = "show-launcher" | "open-combat" | "open-overlay" | "open-rewards" | "open-market" | "exit" | undefined;

export function launcherMinimizeAction(minimizeToTray: boolean): LauncherMinimizeAction {
  return minimizeToTray ? "hide" : "minimize";
}

export function trayAction(action: string): TrayAction {
  if (action === "show-launcher") return "show-launcher";
  if (action === "open-combat") return "open-combat";
  if (action === "open-overlay") return "open-overlay";
  if (action === "open-rewards") return "open-rewards";
  if (action === "open-market") return "open-market";
  if (action === "exit") return "exit";
  return undefined;
}
