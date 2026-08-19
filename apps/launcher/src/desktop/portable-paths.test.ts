import { expect, test } from "bun:test";
import path from "node:path";

import { resolveDesktopStoragePaths } from "./portable-paths.ts";

test("environment-root storage remains beneath the extracted application root", () => {
  const root = path.resolve("fictional-portable-app");
  const paths = resolveDesktopStoragePaths({ root });

  expect(paths).toEqual({
    root,
    logDirectory: path.join(root, "data", "logs"),
    launcherSettingsPath: path.join(root, "data", "settings", "launcher.json"),
    dpsSettingsPath: path.join(root, "data", "settings", "dps.json"),
    overlaySettingsPath: path.join(root, "data", "settings", "overlay.json"),
    rewardsSettingsPath: path.join(root, "data", "settings", "rewards.json"),
    windowPlacementsPath: path.join(root, "data", "settings", "windows.json"),
    characterStatePath: path.join(root, "data", "character.json"),
    inspectedCharactersPath: path.join(root, "data", "inspected-characters.sqlite"),
    actorIdentitiesPath: path.join(root, "data", "actor-identities.json"),
  });
});

test("workspace development keeps logs in the data directory", () => {
  const root = path.resolve("fictional-workspace");
  const paths = resolveDesktopStoragePaths({ root });

  expect(paths.logDirectory).toBe(path.join(root, "data", "logs"));
  expect(paths.launcherSettingsPath).toBe(path.join(root, "data", "settings", "launcher.json"));
});

test("executable-adjacent storage uses packaged log layout and honors an override", () => {
  const root = path.resolve("fictional-executable-directory");
  const override = path.resolve("fictional-log-override");
  const paths = resolveDesktopStoragePaths({ root, logDirectoryOverride: `  ${override}  ` });

  expect(paths.root).toBe(root);
  expect(paths.logDirectory).toBe(override);
  expect(paths.characterStatePath).toBe(path.join(root, "data", "character.json"));
  expect(paths.inspectedCharactersPath).toBe(path.join(root, "data", "inspected-characters.sqlite"));
});
