import { expect, test } from "bun:test";

import { launcherMinimizeAction, trayAction } from "./launcher-tray-actions.ts";

test("launcher minimize hides only when minimize-to-tray is enabled", () => {
  expect(launcherMinimizeAction(false)).toBe("minimize");
  expect(launcherMinimizeAction(true)).toBe("hide");
});

test("tray menu actions restore the launcher or perform a full exit", () => {
  expect(trayAction("")).toBeUndefined();
  expect(trayAction("show-launcher")).toBe("show-launcher");
  expect(trayAction("open-combat")).toBe("open-combat");
  expect(trayAction("open-overlay")).toBe("open-overlay");
  expect(trayAction("open-rewards")).toBe("open-rewards");
  expect(trayAction("open-market")).toBe("open-market");
  expect(trayAction("exit")).toBe("exit");
  expect(trayAction("unknown")).toBeUndefined();
});
