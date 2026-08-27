import { expect, test } from "bun:test";

import {
  isNonWindowsNeutralinoBinary,
  windowsNeutralinoBinary,
} from "./select-windows-release-binaries.ts";

test("selects only the Windows x64 Neutralino launcher for release", () => {
  expect(isNonWindowsNeutralinoBinary("neutralino-linux_x64")).toBe(true);
  expect(isNonWindowsNeutralinoBinary("neutralino-linux_arm64")).toBe(true);
  expect(isNonWindowsNeutralinoBinary("neutralino-mac_x64")).toBe(true);
  expect(isNonWindowsNeutralinoBinary("neutralino-mac_universal")).toBe(true);
  expect(isNonWindowsNeutralinoBinary(windowsNeutralinoBinary)).toBe(false);
  expect(isNonWindowsNeutralinoBinary("bun.exe")).toBe(false);
  expect(isNonWindowsNeutralinoBinary("sv-overlay-hotkeys.exe")).toBe(false);
});
