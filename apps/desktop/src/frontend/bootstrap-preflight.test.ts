import { describe, expect, test } from "bun:test";

import { BootstrapRuntimeError, neutralinoPlatform, verifyBootstrapRuntime } from "./bootstrap-preflight.ts";

describe("Neutralino frontend bootstrap preflight", () => {
  test("reads the bundled runtime without depending on that runtime", async () => {
    const calls: string[] = [];
    await verifyBootstrapRuntime({
      applicationPath: "C:\\Spirit Vale",
      platform: "win32",
      filesystem: {
        getStats: async (path) => { calls.push(`stat:${path}`); return { size: 10, isFile: true }; },
        access: async (path) => { calls.push(`access:${path}`); },
        readBinaryFile: async (path) => { calls.push(`read:${path}`); return new Uint8Array([1]).buffer; },
      },
    });
    expect(calls).toEqual([
      "stat:C:\\Spirit Vale/extensions/bin/bun.exe",
      "access:C:\\Spirit Vale/extensions/bin/bun.exe",
      "read:C:\\Spirit Vale/extensions/bin/bun.exe",
    ]);
  });

  test("retries and reports a missing runtime with its path and native code", async () => {
    let attempts = 0;
    const missing = Object.assign(new Error("Path does not exist"), { code: "NE_FS_NOPATHE" });
    try {
      await verifyBootstrapRuntime({
        applicationPath: "/opt/spirit-vale",
        platform: "linux",
        attempts: 3,
        retryDelayMs: 0,
        filesystem: {
          getStats: async () => { attempts += 1; throw missing; },
          access: async () => {},
          readBinaryFile: async () => new ArrayBuffer(0),
        },
      });
      throw new Error("Expected bootstrap preflight to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BootstrapRuntimeError);
      expect((error as BootstrapRuntimeError).details).toMatchObject({
        operation: "bundle-read",
        path: "/opt/spirit-vale/extensions/bin/bun",
        code: "NE_FS_NOPATHE",
      });
      expect(attempts).toBe(3);
    }
  });

  test("maps Neutralino operating-system names", () => {
    expect(neutralinoPlatform("Windows")).toBe("win32");
    expect(neutralinoPlatform("Darwin")).toBe("darwin");
    expect(neutralinoPlatform("Linux")).toBe("linux");
  });
});
