import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const shortcutScript = await readFile(path.join(import.meta.dir, "build-portable-shortcut.ps1"), "utf8");

test("portable shortcut records a target relative to the shortcut", () => {
  expect(shortcutScript).toContain("IShellLinkW");
  expect(shortcutScript).toContain("SetRelativePath");
  expect(shortcutScript).toContain("MakeRelativeUri");
  expect(shortcutScript).toContain("((IPersistFile)link).Save(outputPath, true)");
});

test("portable shortcut inherits the branded launcher icon", () => {
  expect(shortcutScript).not.toContain("link.SetIconLocation");
});
