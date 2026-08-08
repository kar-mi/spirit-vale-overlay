import {
  resolveLocalStorageRoot,
  resolveWorkspaceRoot as findWorkspaceRoot,
} from "@svoverlay/desktop-platform/local-storage";

export function resolveWorkspaceRoot(): string {
  return findWorkspaceRoot() ?? process.cwd();
}

export function resolveLocalRoot(): string {
  return resolveLocalStorageRoot();
}
