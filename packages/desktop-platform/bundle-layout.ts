import { executableBaseNames, platformExecutableName } from "./executable-names.ts";

// Every path a built desktop bundle is made of, relative to the application root
// (Neutralino's NL_PATH). Startup preflight, the backend, the frontend failure card,
// the build script and the release verifier all describe the same bundle, so they all
// read this layout instead of repeating literals that only some of them would be
// updated when the layout moves.
export const bundleLayout = {
  resourceBundle: "resources.neu",
  resourcesDirectory: "resources",
  viewsDirectory: "resources/views",
  extensionsDirectory: "extensions",
  backendDirectory: "extensions/backend",
  backendEntrypoint: "extensions/backend/index.js",
  backendSourceMap: "extensions/backend/index.js.map",
  binaryDirectory: "extensions/bin",
  portableMarker: ".spirit-vale-portable",
  portableReadme: "README.txt",
  backendOwnerFile: ".neutralino-backend-owner.json",
  neutralinoLog: "neutralinojs.log",
  backendLog: "neutralino-backend.log",
} as const;

// The Electron build ships the plain resources/ tree (no resources.neu) with the
// backend sidecars staged under resources/extensions/** via electron-builder
// extraResources. Paths are relative to the bundle root — the folder that holds
// "Spirit Vale Overlay.exe" — which is also where portable `data/` lives.
export const electronBundleLayout = {
  resourcesDirectory: "resources",
  viewsDirectory: "resources/views",
  extensionsDirectory: "resources/extensions",
  backendDirectory: "resources/extensions/backend",
  backendEntrypoint: "resources/extensions/backend/index.js",
  binaryDirectory: "resources/extensions/bin",
  portableMarker: bundleLayout.portableMarker,
  portableReadme: bundleLayout.portableReadme,
  portableRuntimeData: "data/runtime",
  backendLog: "electron-backend.log",
} as const;

/** The bundled Bun for the Electron build, relative to the bundle root. */
export function electronBundledRuntimePath(platform: NodeJS.Platform = process.platform): string {
  return `${electronBundleLayout.binaryDirectory}/${platformExecutableName(executableBaseNames.bunRuntime, platform)}`;
}

/** The bundled pass-through hotkey helper for the Electron build, relative to the bundle root. */
export function electronBundledHotkeyHelperPath(platform: NodeJS.Platform = process.platform): string {
  return `${electronBundleLayout.binaryDirectory}/${platformExecutableName(executableBaseNames.hotkeyHelper, platform)}`;
}

/** Joins a bundle-relative path onto an application root, native separators included. */
export function joinBundlePath(applicationPath: string, relativePath: string): string {
  return `${applicationPath.replace(/[\\/]+$/, "")}/${relativePath}`;
}

/** The bundled Bun that runs the backend extension. */
export function bundledRuntimePath(platform: NodeJS.Platform = process.platform): string {
  return `${bundleLayout.binaryDirectory}/${platformExecutableName(executableBaseNames.bunRuntime, platform)}`;
}

/** The bundled helper that forwards pass-through hotkeys. */
export function bundledHotkeyHelperPath(platform: NodeJS.Platform = process.platform): string {
  return `${bundleLayout.binaryDirectory}/${platformExecutableName(executableBaseNames.hotkeyHelper, platform)}`;
}

/**
 * The extension command Neutralino spawns for the backend. `applicationPath` is
 * Neutralino's own `${NL_PATH}` placeholder in neutralino.config.json, and a real
 * directory everywhere else.
 */
export function backendExtensionCommand(
  applicationPath: string,
  platform: NodeJS.Platform = "win32",
): string {
  const runtime = joinBundlePath(applicationPath, bundledRuntimePath(platform));
  const entrypoint = joinBundlePath(applicationPath, bundleLayout.backendEntrypoint);
  return `"${runtime}" --no-orphans "${entrypoint}"`;
}

/** The log files worth pointing a user at when startup fails. */
export function bundleLogPaths(applicationPath: string): string[] {
  return [
    joinBundlePath(applicationPath, bundleLayout.neutralinoLog),
    joinBundlePath(applicationPath, bundleLayout.backendLog),
  ];
}
