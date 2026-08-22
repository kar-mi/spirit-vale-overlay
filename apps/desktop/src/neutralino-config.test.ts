import { describe, expect, test } from "bun:test";

interface NeutralinoConfig {
  extensions?: Array<{
    id?: string;
    commandWindows?: string;
  }>;
}

describe("Neutralino configuration", () => {
  test("runs the backend with the bundled Bun and orphan cleanup", async () => {
    const config = (await Bun.file(
      `${import.meta.dir}/../neutralino.config.json`,
    ).json()) as NeutralinoConfig;
    const backend = config.extensions?.find(
      (extension) => extension.id === "dev.spiritvale.backend",
    );

    expect(backend?.commandWindows).toBe(
      "${NL_PATH}/extensions/bin/bun.exe --no-orphans ${NL_PATH}/extensions/backend/index.js",
    );
  });
});
