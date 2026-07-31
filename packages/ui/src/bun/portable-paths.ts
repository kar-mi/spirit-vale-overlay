import path from "node:path";

export interface DesktopStoragePaths {
  readonly portable: boolean;
  readonly root?: string;
  readonly logDirectory: string;
  readonly launcherSettingsPath: string;
  readonly dpsSettingsPath: string;
  readonly overlaySettingsPath: string;
  readonly rewardsSettingsPath: string;
  readonly xpTrackerSettingsPath: string;
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
    xpTrackerSettingsPath: path.join(settingsDirectory, "xp-tracker.json"),
    windowPlacementsPath: path.join(settingsDirectory, "windows.json"),
    characterStatePath: path.join(dataDirectory, "character.json"),
    actorIdentitiesPath: path.join(dataDirectory, "actor-identities.json"),
  };
}
