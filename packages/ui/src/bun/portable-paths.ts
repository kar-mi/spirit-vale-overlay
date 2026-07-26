import path from "node:path";
import { copyFile, mkdir, stat } from "node:fs/promises";

export interface DesktopStoragePaths {
  readonly portable: boolean;
  readonly root?: string;
  readonly logDirectory: string;
  readonly launcherSettingsPath: string;
  readonly dpsSettingsPath: string;
  readonly overlaySettingsPath: string;
  readonly rewardsSettingsPath: string;
  readonly windowPlacementsPath: string;
  readonly characterStatePath: string;
  readonly actorIdentitiesPath: string;
}

export interface DesktopStoragePathOptions {
  readonly root: string;
  readonly workspaceDev: boolean;
  readonly portable?: boolean;
  readonly logDirectoryOverride?: string;
}

export function resolveDesktopStoragePaths(options: DesktopStoragePathOptions): DesktopStoragePaths {
  const root = path.resolve(options.root);
  const dataDirectory = path.join(root, "data");
  const settingsDirectory = path.join(dataDirectory, "settings");
  return {
    portable: options.portable ?? false,
    root,
    logDirectory: options.logDirectoryOverride?.trim()
      ? path.resolve(options.logDirectoryOverride.trim())
      : path.join(root, options.workspaceDev ? "logs" : path.join("data", "logs")),
    launcherSettingsPath: path.join(settingsDirectory, "launcher.json"),
    dpsSettingsPath: path.join(settingsDirectory, "dps.json"),
    overlaySettingsPath: path.join(settingsDirectory, "overlay.json"),
    rewardsSettingsPath: path.join(settingsDirectory, "rewards.json"),
    windowPlacementsPath: path.join(settingsDirectory, "windows.json"),
    characterStatePath: path.join(dataDirectory, "character.json"),
    actorIdentitiesPath: path.join(dataDirectory, "actor-identities.json"),
  };
}

export async function migrateLegacyUserData(storagePaths: DesktopStoragePaths, legacyUserData: string): Promise<void> {
  const migrations = [
    [path.join(legacyUserData, "spirit-vale-overlay", "settings.json"), storagePaths.overlaySettingsPath],
    [path.join(legacyUserData, "spirit-vale-dps", "settings.json"), storagePaths.dpsSettingsPath],
    [path.join(legacyUserData, "spirit-vale-tools", "settings.json"), storagePaths.launcherSettingsPath],
    [path.join(legacyUserData, "spirit-vale-tools", "windows.json"), storagePaths.windowPlacementsPath],
    [path.join(legacyUserData, "spirit-vale-tools", "character.json"), storagePaths.characterStatePath],
    [path.join(legacyUserData, "rewards-settings.json"), storagePaths.rewardsSettingsPath],
  ] as const;

  await Promise.all(migrations.map(async ([source, destination]) => {
    if (await fileExists(destination) || !await fileExists(source)) return;
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }));
}

async function fileExists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}
