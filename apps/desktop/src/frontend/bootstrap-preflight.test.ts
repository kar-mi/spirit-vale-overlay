import { describe, expect, test } from "bun:test";
import { bundleLayout, bundledRuntimePath } from "@svoverlay/desktop-platform/bundle-layout";

import { BootstrapRuntimeError, neutralinoPlatform, verifyBootstrapFiles } from "./bootstrap-preflight.ts";

const windowsRuntime = bundledRuntimePath("win32");
const linuxRuntime = bundledRuntimePath("linux");
const entrypoint = bundleLayout.backendEntrypoint;

describe("Neutralino frontend bootstrap preflight", () => {
  test("reads the bundled runtime without depending on that runtime", async () => {
    const calls: string[] = [];
    await verifyBootstrapFiles({
      applicationPath: "C:\\Spirit Vale",
      platform: "win32",
      filesystem: {
        getStats: async (path) => { calls.push(`stat:${path}`); return { size: 10, isFile: true }; },
        readBinaryFile: async (path) => { calls.push(`read:${path}`); return new Uint8Array([1]).buffer; },
      },
    });
    expect(calls).toHaveLength(4);
    expect(calls).toEqual(expect.arrayContaining([
      `stat:C:\\Spirit Vale/${windowsRuntime}`,
      `read:C:\\Spirit Vale/${windowsRuntime}`,
      `stat:C:\\Spirit Vale/${entrypoint}`,
      `read:C:\\Spirit Vale/${entrypoint}`,
    ]));
  });

  test("retries and reports a missing runtime with its path and native code", async () => {
    let attempts = 0;
    const missing = Object.assign(new Error("Path does not exist"), { code: "NE_FS_NOPATHE" });
    try {
      await verifyBootstrapFiles({
        applicationPath: "/opt/spirit-vale",
        platform: "linux",
        attempts: 3,
        retryDelayMs: 0,
        filesystem: {
          getStats: async (path) => {
            attempts += 1;
            if (path.includes("/bin/")) throw missing;
            return { size: 10, isFile: true };
          },
          readBinaryFile: async () => new Uint8Array([1]).buffer,
        },
      });
      throw new Error("Expected bootstrap preflight to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BootstrapRuntimeError);
      expect((error as BootstrapRuntimeError).details).toMatchObject({
        operation: "bundle-read",
        path: `/opt/spirit-vale/${linuxRuntime}`,
        code: "NE_FS_NOPATHE",
      });
      expect(attempts).toBe(4);
    }
  });

  test("reports a missing backend entrypoint before Bun is needed", async () => {
    try {
      await verifyBootstrapFiles({
        applicationPath: "C:\\Spirit Vale",
        platform: "win32",
        attempts: 1,
        filesystem: {
          getStats: async (path) => {
            if (path.endsWith("index.js")) throw Object.assign(new Error("Path does not exist"), { code: "NE_FS_NOPATHE" });
            return { size: 10, isFile: true };
          },
          readBinaryFile: async () => new Uint8Array([1]).buffer,
        },
      });
      throw new Error("Expected bootstrap preflight to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BootstrapRuntimeError);
      expect((error as BootstrapRuntimeError).details.path).toBe(`C:\\Spirit Vale/${entrypoint}`);
    }
  });

  test("maps Neutralino operating-system names", () => {
    expect(neutralinoPlatform("Windows")).toBe("win32");
    expect(neutralinoPlatform("Darwin")).toBe("darwin");
    expect(neutralinoPlatform("Linux")).toBe("linux");
  });
});
