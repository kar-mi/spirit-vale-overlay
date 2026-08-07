import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { measureLogStorage } from "./log-storage.ts";

async function withDirectory(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "spiritvale-log-storage-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

describe("log storage measurement", () => {
  test("totals every file in the tree", async () => {
    await withDirectory(async (root) => {
      await mkdir(path.join(root, "sessions", "one"), { recursive: true });
      await mkdir(path.join(root, "sessions", "two"), { recursive: true });
      await writeFile(path.join(root, "sessions", "one", "combat.jsonl"), "x".repeat(1_000));
      await writeFile(path.join(root, "sessions", "one", "rewards.jsonl"), "x".repeat(500));
      await writeFile(path.join(root, "sessions", "two", "combat.jsonl"), "x".repeat(250));
      await writeFile(path.join(root, "loose.json"), "x".repeat(10));

      const usage = await measureLogStorage(root);
      expect(usage).toMatchObject({ bytes: 1_760, files: 4 });
      expect(Number.isFinite(Date.parse(usage!.measuredAt))).toBe(true);
    });
  });

  test("is stable across repeated runs", async () => {
    // The walk totals concurrently; accumulating into a shared counter across awaits would drop
    // updates and make the same tree measure differently each time.
    await withDirectory(async (root) => {
      for (let index = 0; index < 40; index += 1) {
        const directory = path.join(root, "sessions", `session-${index}`);
        await mkdir(directory, { recursive: true });
        for (const stream of ["combat", "rewards", "market"]) {
          await writeFile(path.join(directory, `${stream}.jsonl`), "x".repeat(100 + index));
        }
      }
      const first = await measureLogStorage(root);
      const second = await measureLogStorage(root);
      const third = await measureLogStorage(root);
      expect(first!.files).toBe(120);
      expect(second!.bytes).toBe(first!.bytes);
      expect(third!.bytes).toBe(first!.bytes);
    });
  });

  test("counts an empty tree as zero rather than failing", async () => {
    await withDirectory(async (root) => {
      await mkdir(path.join(root, "sessions"), { recursive: true });
      expect(await measureLogStorage(root)).toMatchObject({ bytes: 0, files: 0 });
    });
  });

  test("resolves to undefined when the directory is missing", async () => {
    expect(await measureLogStorage(path.join(tmpdir(), `spiritvale-absent-${crypto.randomUUID()}`)))
      .toBeUndefined();
  });

  test("does not follow symlinks out of the log directory", async () => {
    await withDirectory(async (root) => {
      const outside = path.join(root, "outside");
      const logs = path.join(root, "logs");
      await mkdir(outside, { recursive: true });
      await mkdir(logs, { recursive: true });
      await writeFile(path.join(outside, "huge.bin"), "x".repeat(9_000));
      await writeFile(path.join(logs, "real.jsonl"), "x".repeat(100));
      // Symlinks may require Windows developer mode; without one the assertion below still holds,
      // it just stops being the interesting case.
      try { await symlink(outside, path.join(logs, "linked"), "dir"); } catch { /* not available */ }

      // The 9,000 bytes behind the link are not this directory's usage.
      expect(await measureLogStorage(logs)).toMatchObject({ bytes: 100, files: 1 });
    });
  });
});
