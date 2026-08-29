import { describe, expect, test } from "bun:test";

interface NeutralinoConfig {
  applicationName?: string;
  author?: string;
  description?: string;
  copyright?: string;
  applicationIcon?: string;
  nativeAllowList?: string[];
  extensions?: Array<{
    id?: string;
    commandWindows?: string;
  }>;
  cli?: {
    copyItems?: string[];
  };
}

describe("Neutralino configuration", () => {
  test("does not expose process execution to renderer code", async () => {
    const config = (await Bun.file(
      `${import.meta.dir}/../neutralino.config.json`,
    ).json()) as NeutralinoConfig;

    expect(config.nativeAllowList).not.toContain("os.execCommand");
    expect(config.nativeAllowList).not.toContain("os.spawnProcess");
  });

  test("runs the backend with the bundled Bun and orphan cleanup", async () => {
    const config = (await Bun.file(
      `${import.meta.dir}/../neutralino.config.json`,
    ).json()) as NeutralinoConfig;
    const backend = config.extensions?.find(
      (extension) => extension.id === "dev.spiritvale.backend",
    );

    expect(backend?.commandWindows).toBe(
      "\"${NL_PATH}/extensions/bin/bun.exe\" --no-orphans \"${NL_PATH}/extensions/backend/index.js\"",
    );

    const localizedPath = "C:/Users/Zoë 李/Spirit & Vale (portable)";
    expect(backend?.commandWindows?.replaceAll("${NL_PATH}", localizedPath)).toBe(
      `"${localizedPath}/extensions/bin/bun.exe" --no-orphans "${localizedPath}/extensions/backend/index.js"`,
    );
  });

  test("lets Neutralino brand and assemble portable release bundles", async () => {
    const config = (await Bun.file(
      `${import.meta.dir}/../neutralino.config.json`,
    ).json()) as NeutralinoConfig;

    expect(config).toMatchObject({
      applicationName: "Spirit Vale Overlay",
      author: "kar-mi",
      description: "Spirit Vale Overlay",
      copyright: "Copyright (C) 2026 kar-mi. Licensed under the GNU AGPL v3.",
      applicationIcon: "resources/views/assets/app-icon.png",
      cli: {
        copyItems: [".spirit-vale-portable", "README.txt"],
      },
    });
  });
});
