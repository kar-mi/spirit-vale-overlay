import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { migrateLegacyUserData, resolveDesktopStoragePaths } from "./portable-paths.ts";

test("environment-root storage remains beneath the extracted application root", () => {
  const root = path.resolve("fictional-portable-app");
  const paths = resolveDesktopStoragePaths({ root, portable: true, workspaceDev: false });

  expect(paths).toEqual({
    portable: true,
    root,
    logDirectory: path.join(root, "data", "logs"),
    launcherSettingsPath: path.join(root, "data", "settings", "launcher.json"),
    dpsSettingsPath: path.join(root, "data", "settings", "dps.json"),
    overlaySettingsPath: path.join(root, "data", "settings", "overlay.json"),
    rewardsSettingsPath: path.join(root, "data", "settings", "rewards.json"),
    windowPlacementsPath: path.join(root, "data", "settings", "windows.json"),
    characterStatePath: path.join(root, "data", "character.json"),
    actorIdentitiesPath: path.join(root, "data", "actor-identities.json"),
  });
});

test("workspace development keeps logs at the workspace root", () => {
  const root = path.resolve("fictional-workspace");
  const paths = resolveDesktopStoragePaths({ root, workspaceDev: true });

  expect(paths.portable).toBe(false);
  expect(paths.logDirectory).toBe(path.join(root, "logs"));
  expect(paths.launcherSettingsPath).toBe(path.join(root, "data", "settings", "launcher.json"));
});

test("executable-adjacent storage uses packaged log layout and honors an override", () => {
  const root = path.resolve("fictional-executable-directory");
  const override = path.resolve("fictional-log-override");
  const paths = resolveDesktopStoragePaths({ root, workspaceDev: false, logDirectoryOverride: `  ${override}  ` });

  expect(paths.root).toBe(root);
  expect(paths.logDirectory).toBe(override);
  expect(paths.characterStatePath).toBe(path.join(root, "data", "character.json"));
});

test("migration copies missing legacy files without replacing local state", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "spirit-vale-storage-"));
  try {
    const legacyUserData = path.join(temporaryDirectory, "legacy");
    const root = path.join(temporaryDirectory, "local");
    const paths = resolveDesktopStoragePaths({ root, workspaceDev: false });
    const legacyLauncher = path.join(legacyUserData, "spirit-vale-tools", "settings.json");
    const legacyDps = path.join(legacyUserData, "spirit-vale-dps", "settings.json");
    await mkdir(path.dirname(legacyLauncher), { recursive: true });
    await mkdir(path.dirname(legacyDps), { recursive: true });
    await mkdir(path.dirname(paths.dpsSettingsPath), { recursive: true });
    await writeFile(legacyLauncher, "legacy", "utf8");
    await writeFile(legacyDps, "dps", "utf8");
    await writeFile(paths.dpsSettingsPath, "local", "utf8");

    await migrateLegacyUserData(paths, legacyUserData);

    expect(await readFile(paths.launcherSettingsPath, "utf8")).toBe("legacy");
    expect(await readFile(paths.dpsSettingsPath, "utf8")).toBe("local");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
