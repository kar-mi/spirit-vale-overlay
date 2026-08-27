import { existsSync } from "node:fs";
import path from "node:path";

export const appDataDirectoryName = "Spirit Vale Overlay";

type Environment = Record<string, string | undefined>;

export interface LocalStorageRootOptions {
  readonly environment?: Environment;
  readonly executablePath?: string;
  readonly findWorkspaceRoot?: () => string | undefined;
}

function findWorkspaceRoot(): string | undefined {
  let current = process.cwd();
  while (true) {
    if (existsSync(path.join(current, "bun.lock")) && existsSync(path.join(current, "packages"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function resolveWorkspaceRoot(): string | undefined {
  return findWorkspaceRoot();
}

export function resolveLocalStorageRoot(options: LocalStorageRootOptions = {}): string {
  const environment = options.environment ?? process.env;
  const portableRoot = environment.SPIRIT_VALE_PORTABLE_ROOT?.trim();
  if (portableRoot) return path.resolve(portableRoot);

  const workspaceRoot = environment.SPIRIT_VALE_PACKAGED === "1"
    ? undefined
    : (options.findWorkspaceRoot ?? findWorkspaceRoot)();
  if (workspaceRoot) return workspaceRoot;

  const appDataRoot = environment.APPDATA?.trim() || environment.LOCALAPPDATA?.trim();
  if (appDataRoot) return path.resolve(appDataRoot, appDataDirectoryName);

  const executableDirectory = path.dirname(options.executablePath ?? process.execPath);
  return path.basename(executableDirectory).toLowerCase() === "bin"
    ? path.dirname(executableDirectory)
    : executableDirectory;
}

export function isWorkspaceDevelopmentRoot(root: string): boolean {
  const workspaceRoot = findWorkspaceRoot();
  return workspaceRoot !== undefined && path.resolve(root) === workspaceRoot;
}
