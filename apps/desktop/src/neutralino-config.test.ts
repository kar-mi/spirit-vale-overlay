import { describe, expect, test } from "bun:test";
import { backendExtensionCommand, bundleLayout } from "@svoverlay/desktop-platform/bundle-layout";

interface NeutralinoConfig {
  version?: string;
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

    expect(backend?.commandWindows).toBe(backendExtensionCommand("${NL_PATH}", "win32"));

    const localizedPath = "C:/Users/Zoë 李/Spirit & Vale (portable)";
    expect(backend?.commandWindows?.replaceAll("${NL_PATH}", localizedPath)).toBe(
      backendExtensionCommand(localizedPath, "win32"),
    );
  });

  test("keeps the packaged version in step with the workspace version", async () => {
    // The backend reports this version to the runtime, the release bundle is named for
    // it, and the portable verifier refuses a mismatch. Bumping one file is enough.
    const [config, packageJson] = await Promise.all([
      Bun.file(`${import.meta.dir}/../neutralino.config.json`).json() as Promise<NeutralinoConfig>,
      Bun.file(`${import.meta.dir}/../../../package.json`).json() as Promise<{ version?: string }>,
    ]);

    expect(config.version).toBe(packageJson.version);
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
        copyItems: [bundleLayout.portableMarker, bundleLayout.portableReadme],
      },
    });
  });

  test("packages the default browser favicon from the application icon", async () => {
    const buildSource = await Bun.file(`${import.meta.dir}/build.ts`).text();
    expect(buildSource).toContain('path.join(resources, "favicon.ico")');
    expect(buildSource).toContain('assets/icon/eggplant_icon.ico');
  });
});
