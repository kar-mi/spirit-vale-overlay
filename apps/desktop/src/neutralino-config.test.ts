import { describe, expect, test } from "bun:test";

interface NeutralinoConfig {
  applicationName?: string;
  author?: string;
  description?: string;
  copyright?: string;
  applicationIcon?: string;
  logging?: { enabled?: boolean; writeToLogFile?: boolean };
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
  test("allows only the process capability required by secondary windows", async () => {
    const config = (await Bun.file(
      `${import.meta.dir}/../neutralino.config.json`,
    ).json()) as NeutralinoConfig;

    // Neutralino's window.create implementation launches each secondary window
    // through os.execCommand internally, even though our frontend never calls it.
    expect(config.nativeAllowList).toContain("os.execCommand");
    expect(config.nativeAllowList).toEqual(expect.arrayContaining([
      "filesystem.access",
      "filesystem.getStats",
      "filesystem.readBinaryFile",
    ]));
    expect(config.nativeAllowList).not.toContain("filesystem.*");
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
      logging: { enabled: true, writeToLogFile: true },
      cli: {
        copyItems: [".spirit-vale-portable", "README.txt"],
      },
    });
  });

  test("packages the default browser favicon from the application icon", async () => {
    const buildSource = await Bun.file(`${import.meta.dir}/build.ts`).text();
    expect(buildSource).toContain('path.join(resources, "favicon.ico")');
    expect(buildSource).toContain('assets/icon/eggplant_icon.ico');
  });
});
