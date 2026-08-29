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
