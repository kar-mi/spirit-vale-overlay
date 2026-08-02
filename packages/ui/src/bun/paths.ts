import {
  resolveLocalStorageRoot,
  resolveWorkspaceRoot as findWorkspaceRoot,
} from "@spiritvale/ui-core/local-storage";

export function resolveWorkspaceRoot(): string {
  return findWorkspaceRoot() ?? process.cwd();
}

export function resolveLocalRoot(): string {
  return resolveLocalStorageRoot();
}
