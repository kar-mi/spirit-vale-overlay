import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export const portableMarkerName = ".spirit-vale-portable";

type Environment = Record<string, string | undefined>;

export interface PortableEnvironmentOptions {
  readonly executablePath?: string;
  readonly environment?: Environment;
  readonly markerExists?: (markerPath: string) => boolean;
  readonly createDirectory?: (directoryPath: string) => Promise<unknown>;
}

export function resolvePortableRoot(
  executablePath: string,
  markerExists: (markerPath: string) => boolean = existsSync,
): string | undefined {
  const executableDirectory = path.dirname(path.resolve(executablePath));
  if (path.basename(executableDirectory).toLowerCase() !== "bin") return undefined;
  const root = path.dirname(executableDirectory);
  return markerExists(path.join(root, portableMarkerName)) ? root : undefined;
}

/** Configure portable paths before Electrobun is imported and WebView2 is initialized. */
export async function configurePortableEnvironment(options: PortableEnvironmentOptions = {}): Promise<string | undefined> {
  const executablePath = options.executablePath ?? process.execPath;
  const environment = options.environment ?? process.env;
  const root = resolvePortableRoot(executablePath, options.markerExists);
  if (!root) return undefined;

  const dataDirectory = path.join(root, "data");
  const directories = {
    logs: path.join(dataDirectory, "logs"),
    settings: path.join(dataDirectory, "settings"),
    local: path.join(dataDirectory, "runtime", "local"),
    roaming: path.join(dataDirectory, "runtime", "roaming"),
    temp: path.join(dataDirectory, "runtime", "temp"),
    webview2: path.join(dataDirectory, "runtime", "webview2"),
  };
  const createDirectory = options.createDirectory ?? ((directoryPath: string) => mkdir(directoryPath, { recursive: true }));
  await Promise.all(Object.values(directories).map((directoryPath) => createDirectory(directoryPath)));

  environment.SPIRIT_VALE_PORTABLE_ROOT = root;
  environment.SPIRIT_VALE_LOG_DIRECTORY = directories.logs;
  environment.LOCALAPPDATA = directories.local;
  environment.APPDATA = directories.roaming;
  environment.TEMP = directories.temp;
  environment.TMP = directories.temp;
  environment.WEBVIEW2_USER_DATA_FOLDER = directories.webview2;
  return root;
}
