import path from "node:path";

export interface DesktopStoragePaths {
  readonly root?: string;
  readonly logDirectory: string;
  readonly launcherSettingsPath: string;
  readonly dpsSettingsPath: string;
  readonly overlaySettingsPath: string;
  readonly rewardsSettingsPath: string;
  readonly minimapSettingsPath: string;
  readonly windowPlacementsPath: string;
  readonly characterStatePath: string;
  readonly inspectedCharactersPath: string;
  readonly actorIdentitiesPath: string;
}

export interface DesktopStoragePathOptions {
  readonly root: string;
  readonly logDirectoryOverride?: string;
}

export function resolveDesktopStoragePaths(options: DesktopStoragePathOptions): DesktopStoragePaths {
  const root = path.resolve(options.root);
  const dataDirectory = path.join(root, "data");
  const settingsDirectory = path.join(dataDirectory, "settings");
  return {
    root,
    logDirectory: options.logDirectoryOverride?.trim()
      ? path.resolve(options.logDirectoryOverride.trim())
      : path.join(dataDirectory, "logs"),
    launcherSettingsPath: path.join(settingsDirectory, "launcher.json"),
    dpsSettingsPath: path.join(settingsDirectory, "dps.json"),
    overlaySettingsPath: path.join(settingsDirectory, "overlay.json"),
    rewardsSettingsPath: path.join(settingsDirectory, "rewards.json"),
    minimapSettingsPath: path.join(settingsDirectory, "minimap.json"),
    windowPlacementsPath: path.join(settingsDirectory, "windows.json"),
    characterStatePath: path.join(dataDirectory, "character.json"),
    inspectedCharactersPath: path.join(dataDirectory, "inspected-characters.sqlite"),
    actorIdentitiesPath: path.join(dataDirectory, "actor-identities.json"),
  };
}
