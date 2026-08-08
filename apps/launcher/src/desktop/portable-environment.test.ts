import { expect, test } from "bun:test";
import path from "node:path";

import {
  configurePortableEnvironment,
  portableMarkerName,
  resolvePortableRoot,
} from "./portable-environment.ts";

test("portable root requires a marker beside the bin directory", () => {
  const root = path.resolve("fictional-portable-app");
  const executable = path.join(root, "bin", "bun.exe");
  expect(resolvePortableRoot(executable, (candidate) => candidate === path.join(root, portableMarkerName))).toBe(root);
  expect(resolvePortableRoot(executable, () => false)).toBeUndefined();
  expect(resolvePortableRoot(path.join(root, "bun.exe"), () => true)).toBeUndefined();
});

test("portable bootstrap redirects all writable runtime paths beneath data", async () => {
  const root = path.resolve("fictional-portable-app");
  const environment: Record<string, string | undefined> = {};
  const created: string[] = [];

  expect(await configurePortableEnvironment({
    executablePath: path.join(root, "bin", "bun.exe"),
    environment,
    markerExists: () => true,
    createDirectory: (directoryPath) => { created.push(directoryPath); return Promise.resolve(); },
  })).toBe(root);

  expect(environment).toEqual({
    SPIRIT_VALE_PORTABLE_ROOT: root,
    SPIRIT_VALE_LOG_DIRECTORY: path.join(root, "data", "logs"),
    LOCALAPPDATA: path.join(root, "data", "runtime", "local"),
    APPDATA: path.join(root, "data", "runtime", "roaming"),
    TEMP: path.join(root, "data", "runtime", "temp"),
    TMP: path.join(root, "data", "runtime", "temp"),
    WEBVIEW2_USER_DATA_FOLDER: path.join(root, "data", "runtime", "webview2"),
  });
  expect(created).toEqual([
    path.join(root, "data", "logs"),
    path.join(root, "data", "settings"),
    path.join(root, "data", "runtime", "local"),
    path.join(root, "data", "runtime", "roaming"),
    path.join(root, "data", "runtime", "temp"),
    path.join(root, "data", "runtime", "webview2"),
  ]);
});

test("non-portable bootstrap does not mutate the environment or filesystem", async () => {
  const environment = { EXISTING: "value" };
  let created = false;
  expect(await configurePortableEnvironment({
    executablePath: path.resolve("installed", "bin", "bun.exe"),
    environment,
    markerExists: () => false,
    createDirectory: () => { created = true; return Promise.resolve(); },
  })).toBeUndefined();
  expect(environment).toEqual({ EXISTING: "value" });
  expect(created).toBe(false);
});
