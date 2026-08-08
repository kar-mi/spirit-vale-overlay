import { existsSync } from "node:fs";
import path from "node:path";

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

export function resolveLocalStorageRoot(): string {
  const portableRoot = process.env.SPIRIT_VALE_PORTABLE_ROOT?.trim();
  if (portableRoot) return path.resolve(portableRoot);

  const workspaceRoot = findWorkspaceRoot();
  if (workspaceRoot) return workspaceRoot;

  const executableDirectory = path.dirname(process.execPath);
  return path.basename(executableDirectory).toLowerCase() === "bin"
    ? path.dirname(executableDirectory)
    : executableDirectory;
}

export function isWorkspaceDevelopmentRoot(root: string): boolean {
  const workspaceRoot = findWorkspaceRoot();
  return workspaceRoot !== undefined && path.resolve(root) === workspaceRoot;
}
