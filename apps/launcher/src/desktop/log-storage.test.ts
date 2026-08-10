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
      await mkdir(path.join(root, "combat"), { recursive: true });
      await mkdir(path.join(root, "rewards"), { recursive: true });
      await writeFile(path.join(root, "combat", "one.jsonl"), "x".repeat(1_000));
      await writeFile(path.join(root, "rewards", "one.jsonl"), "x".repeat(500));
      await writeFile(path.join(root, "combat", "two.jsonl"), "x".repeat(250));
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
        for (const stream of ["combat", "rewards"]) {
          const directory = path.join(root, stream);
          await mkdir(directory, { recursive: true });
          await writeFile(path.join(directory, `session-${index}.jsonl`), "x".repeat(100 + index));
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

  test("descends past the two levels the log layout normally has", async () => {
    // The walk is breadth-first so its concurrency limit applies to a flat list per level. Nesting
    // deeper than <stream>/<id>.jsonl is what proves the levels chain rather than stopping at the first.
    await withDirectory(async (root) => {
      let directory = root;
      for (let depth = 0; depth < 6; depth += 1) {
        directory = path.join(directory, `level-${depth}`);
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, "combat.jsonl"), "x".repeat(10));
      }
      expect(await measureLogStorage(root)).toMatchObject({ bytes: 60, files: 6 });
    });
  });

  test("counts an empty tree as zero rather than failing", async () => {
    await withDirectory(async (root) => {
      await mkdir(path.join(root, "combat"), { recursive: true });
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
