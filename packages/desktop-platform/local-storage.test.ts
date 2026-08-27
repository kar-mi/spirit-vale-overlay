import { expect, test } from "bun:test";
import path from "node:path";

import { appDataDirectoryName, resolveLocalStorageRoot } from "./local-storage.ts";

const noWorkspace = (): undefined => undefined;

test("portable storage takes priority over workspace and AppData locations", () => {
  const portableRoot = path.resolve("portable-root");
  expect(resolveLocalStorageRoot({
    environment: { SPIRIT_VALE_PORTABLE_ROOT: portableRoot, APPDATA: path.resolve("roaming") },
    findWorkspaceRoot: () => path.resolve("workspace"),
  })).toBe(portableRoot);
});

test("workspace development keeps storage in the repository", () => {
  const workspaceRoot = path.resolve("workspace");
  expect(resolveLocalStorageRoot({
    environment: { APPDATA: path.resolve("roaming") },
    findWorkspaceRoot: () => workspaceRoot,
  })).toBe(workspaceRoot);
});

test("packaged non-portable storage uses Windows roaming AppData", () => {
  const roaming = path.resolve("roaming");
  expect(resolveLocalStorageRoot({
    environment: { SPIRIT_VALE_PACKAGED: "1", APPDATA: roaming, LOCALAPPDATA: path.resolve("local") },
    findWorkspaceRoot: () => path.resolve("workspace-that-must-be-ignored"),
  })).toBe(path.join(roaming, appDataDirectoryName));
});

test("packaged storage falls back through local AppData to the executable", () => {
  const local = path.resolve("local");
  expect(resolveLocalStorageRoot({
    environment: { LOCALAPPDATA: local },
    findWorkspaceRoot: noWorkspace,
  })).toBe(path.join(local, appDataDirectoryName));

  const bundleRoot = path.resolve("bundle");
  expect(resolveLocalStorageRoot({
    environment: {},
    executablePath: path.join(bundleRoot, "bin", "bun.exe"),
    findWorkspaceRoot: noWorkspace,
  })).toBe(bundleRoot);
});
