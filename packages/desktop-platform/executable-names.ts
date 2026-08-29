export const executableBaseNames = {
  bunRuntime: "bun",
  hotkeyHelper: "sv-overlay-hotkeys",
  gameProcess: "SpiritVale",
  desktopApp: "spirit-vale-overlay",
} as const;

export interface PlatformExecutableNames {
  bunRuntime: string;
  hotkeyHelper: string;
  gameProcess: string;
  desktopApp: string;
}

export function platformExecutableName(baseName: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? `${baseName}.exe` : baseName;
}

export function neutralinoDesktopExecutableName(
  platform: NodeJS.Platform = process.platform,
  architecture: NodeJS.Architecture = process.arch,
): string {
  const arch = architecture === "arm64" ? "arm64" : "x64";
  if (platform === "win32") return `${executableBaseNames.desktopApp}-win_x64.exe`;
  if (platform === "darwin") return `${executableBaseNames.desktopApp}-mac_${arch}`;
  return `${executableBaseNames.desktopApp}-linux_${arch}`;
}

export function executableNamesFor(
  platform: NodeJS.Platform = process.platform,
  architecture: NodeJS.Architecture = process.arch,
): PlatformExecutableNames {
  return {
    bunRuntime: platformExecutableName(executableBaseNames.bunRuntime, platform),
    hotkeyHelper: platformExecutableName(executableBaseNames.hotkeyHelper, platform),
    gameProcess: platformExecutableName(executableBaseNames.gameProcess, platform),
    desktopApp: neutralinoDesktopExecutableName(platform, architecture),
  };
}

export function getCurrentExecutableNames(): PlatformExecutableNames {
  return executableNamesFor();
}
