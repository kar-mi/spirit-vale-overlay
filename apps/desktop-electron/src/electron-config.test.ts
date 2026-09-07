import { createRequire } from "node:module";
import { afterEach, describe, expect, test } from "bun:test";
import { electronBundleLayout } from "@svoverlay/desktop-platform/bundle-layout";

const require = createRequire(import.meta.url);
const configPath = require.resolve("../electron-builder.config.cjs");

/** Re-evaluates the config module with the current process.env. */
function loadConfig(): Record<string, any> {
  delete require.cache[configPath];
  return require(configPath) as Record<string, any>;
}

const savedCI = process.env.CI;
afterEach(() => {
  if (savedCI === undefined) delete process.env.CI;
  else process.env.CI = savedCI;
});

describe("electron-builder configuration", () => {
  test("has no application auto-update publisher", () => {
    const config = loadConfig();
    expect(config.publish).toBeUndefined();
    expect(config.win.target).not.toContain("nsis-web");
  });

  test("ships an unpacked directory, never a self-extracting installer", () => {
    // electron-builder's `portable`/`nsis` targets self-extract to %TEMP%, which breaks
    // the .spirit-vale-portable marker's data/runtime redirection.
    expect(loadConfig().win.target).toEqual(["dir"]);
  });

  test("brands the app", () => {
    const config = loadConfig();
    expect(config.appId).toBe("dev.spiritvale.overlay");
    expect(config.productName).toBe("Spirit Vale Overlay");
    expect(config.copyright).toMatch(/^Copyright \(C\) 2026 kar-mi/);
    expect(config.win.artifactName).toBe("spirit-vale-overlay-electron-windows-x64.${ext}");
  });

  test("edits the executable on CI only", () => {
    process.env.CI = "true";
    expect(loadConfig().win.signAndEditExecutable).toBe(true);
    delete process.env.CI;
    expect(loadConfig().win.signAndEditExecutable).toBe(false);
  });

  test("keeps the backend, its runtime and the views as real files, not asar", () => {
    // The Bun backend is a separate process with no asar awareness; main resolves
    // resources/ through real filesystem paths.
    const config = loadConfig();
    expect(config.files).toEqual(["main/**", "package.json"]);
    expect(config.npmRebuild).toBe(false);
    expect(config.extraResources).toEqual([
      { from: "dist/resources/views", to: "views" },
      { from: "dist/resources/extensions", to: "extensions" },
    ]);
  });

  test("places the portable marker and README next to the exe", () => {
    expect(loadConfig().extraFiles).toEqual([
      { from: electronBundleLayout.portableMarker, to: electronBundleLayout.portableMarker },
      { from: electronBundleLayout.portableReadme, to: electronBundleLayout.portableReadme },
    ]);
  });
});

describe("electron README", () => {
  test("documents the portable data layout and the Electron executable name", async () => {
    const readme = await Bun.file(`${import.meta.dir}/../${electronBundleLayout.portableReadme}`).text();
    for (const text of [
      'run "Spirit Vale Overlay.exe"',
      "data\\settings\\",
      "data\\logs\\",
      "data\\runtime\\",
      "Delete .spirit-vale-portable",
      "Npcap",
      "Windows x64 only",
    ]) {
      expect(readme).toContain(text);
    }
  });
});
