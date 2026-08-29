import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { StartupPreflightError, verifyReadableFiles, verifyWritableDirectories } from "./startup-preflight.ts";

describe("startup filesystem preflight", () => {
  test("round-trips and removes storage probes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spiritvale-preflight-"));
    try {
      const nested = path.join(root, "data", "settings");
      await verifyWritableDirectories([nested, nested]);
      expect(await readdir(nested)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("checks that required bundle files are readable and non-empty", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spiritvale-bundle-"));
    try {
      const readable = path.join(root, "backend.js");
      const empty = path.join(root, "empty.js");
      await writeFile(readable, "export {};", "utf8");
      await writeFile(empty, "", "utf8");
      await verifyReadableFiles([readable]);
      expect(await readFile(readable, "utf8")).toBe("export {};");
      await expect(verifyReadableFiles([empty], { attempts: 1 })).rejects.toMatchObject({
        name: "StartupPreflightError",
        details: { phase: "bundle", operation: "bundle-read", path: empty },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("retries a transient bundle read before failing startup", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spiritvale-bundle-retry-"));
    try {
      const delayed = path.join(root, "resources.neu");
      const retries: number[] = [];
      await verifyReadableFiles([delayed], {
        attempts: 3,
        retryDelayMs: 0,
        onRetry: (_failure, attempt) => {
          retries.push(attempt);
          if (attempt === 1) writeFileSync(delayed, "bundle", "utf8");
        },
      });
      expect(retries).toEqual([1]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports directory creation failures with the affected path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spiritvale-preflight-failure-"));
    try {
      const file = path.join(root, "occupied");
      await writeFile(file, "not a directory", "utf8");
      const target = path.join(file, "settings");
      try {
        await verifyWritableDirectories([target], { attempts: 1 });
        throw new Error("Expected preflight to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(StartupPreflightError);
        expect((error as StartupPreflightError).details).toMatchObject({
          phase: "storage",
          operation: "directory-create",
        });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
