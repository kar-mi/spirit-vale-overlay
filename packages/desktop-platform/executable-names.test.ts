import { describe, expect, test } from "bun:test";

import { executableNamesFor, neutralinoDesktopExecutableName, platformExecutableName } from "./executable-names.ts";

describe("desktop executable names", () => {
  test("adds executable extensions only on Windows", () => {
    expect(platformExecutableName("tool", "win32")).toBe("tool.exe");
    expect(platformExecutableName("tool", "linux")).toBe("tool");
    expect(platformExecutableName("tool", "darwin")).toBe("tool");
  });

  test("matches Neutralino launcher naming across supported platforms", () => {
    expect(neutralinoDesktopExecutableName("win32", "x64")).toBe("spirit-vale-overlay-win_x64.exe");
    expect(neutralinoDesktopExecutableName("linux", "arm64")).toBe("spirit-vale-overlay-linux_arm64");
    expect(neutralinoDesktopExecutableName("darwin", "x64")).toBe("spirit-vale-overlay-mac_x64");
  });

  test("provides one platform-specific name set to runtime consumers", () => {
    expect(executableNamesFor("linux", "x64")).toEqual({
      bunRuntime: "bun",
      hotkeyHelper: "sv-overlay-hotkeys",
      gameProcess: "SpiritVale",
      desktopApp: "spirit-vale-overlay-linux_x64",
    });
  });
});
