import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const launcherScript = await readFile(path.join(import.meta.dir, "build-portable-launcher.ps1"), "utf8");

test("portable launcher redirects writable runtime paths beneath data", () => {
  for (const variable of [
    "SPIRIT_VALE_PORTABLE_ROOT",
    "SPIRIT_VALE_LOG_DIRECTORY",
    "LOCALAPPDATA",
    "APPDATA",
    "TEMP",
    "TMP",
    "WEBVIEW2_USER_DATA_FOLDER",
  ]) {
    expect(launcherScript).toContain(`EnvironmentVariables[\"${variable}\"]`);
  }

  expect(launcherScript).toContain('Path.Combine(root, "data")');
  expect(launcherScript).toContain('Path.Combine(dataDirectory, "runtime")');
  expect(launcherScript).toContain('Path.Combine(runtimeDirectory, "local")');
  expect(launcherScript).toContain('Path.Combine(runtimeDirectory, "roaming")');
  expect(launcherScript).toContain('Path.Combine(runtimeDirectory, "temp")');
  expect(launcherScript).toContain('Path.Combine(runtimeDirectory, "webview2")');
});

test("portable launcher embeds the configured Windows application icon", () => {
  expect(launcherScript).toContain("[string]$IconPath");
  expect(launcherScript).toContain('"/win32icon:$IconPath"');
});
