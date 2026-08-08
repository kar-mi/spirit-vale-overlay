import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const shortcutScript = await readFile(path.join(import.meta.dir, "build-portable-shortcut.ps1"), "utf8");

test("portable shortcut targets the native launcher through Windows Script Host", () => {
  expect(shortcutScript).toContain("New-Object -ComObject WScript.Shell");
  expect(shortcutScript).toContain("$shell.CreateShortcut($resolvedOutput)");
  expect(shortcutScript).toContain("$shortcut.TargetPath = $resolvedTarget");
  expect(shortcutScript).toContain("$shortcut.Save()");
  expect(shortcutScript).not.toContain("Add-Type");
});

test("portable shortcut inherits the branded launcher icon", () => {
  expect(shortcutScript).not.toContain("link.SetIconLocation");
});
