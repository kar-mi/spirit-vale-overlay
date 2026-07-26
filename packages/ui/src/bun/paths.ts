import path from "node:path";
import {
  resolveLocalStorageRoot,
  resolveWorkspaceRoot as findWorkspaceRoot,
} from "@spiritvale/ui-core/local-storage";

export function resolveLogDirectory(): string {
  const override = process.env.SPIRIT_VALE_LOG_DIRECTORY?.trim();
  if (override) return path.resolve(override);
  return path.join(resolveLocalRoot(), "logs");
}

export function resolveWorkspaceRoot(): string {
  return findWorkspaceRoot() ?? process.cwd();
}

export function resolveLocalRoot(): string {
  return resolveLocalStorageRoot();
}
