import { describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createReadModelService } from "./read-model-service.ts";
import type { ReadModelService } from "./read-model-service.ts";

const SESSION = "20260101T000000000Z-0000abcd";
const OTHER = "20260101T010000000Z-0000beef";

async function workspace(): Promise<{ logDirectory: string; cleanup: () => Promise<void> }> {
  const logDirectory = await mkdtemp(path.join(tmpdir(), "spiritvale-readmodel-"));
  await mkdir(path.join(logDirectory, "combat"), { recursive: true });
  for (const id of [SESSION, OTHER]) {
    await writeFile(path.join(logDirectory, "combat", `${id}.jsonl`), "");
  }
  return { logDirectory, cleanup: () => rm(logDirectory, { recursive: true, force: true }) };
}

async function setCurrent(logDirectory: string, sessionId: string): Promise<void> {
  await mkdir(path.join(logDirectory, "current"), { recursive: true });
  await writeFile(
    path.join(logDirectory, "current", "combat.json"),
    JSON.stringify({
      schemaVersion: 1,
      stream: "combat",
      sessionId,
      startedAt: new Date().toISOString(),
      relativePath: path.join("combat", `${sessionId}.jsonl`),
    }),
  );
}

async function appendRecord(logDirectory: string, sessionId: string): Promise<void> {
  const file = path.join(logDirectory, "combat", `${sessionId}.jsonl`);
  sequence += 1;
  await appendFile(file, `${JSON.stringify({
    schemaVersion: 1,
    sessionId,
    sequence,
    recordedAt: new Date().toISOString(),
    source: "test",
    type: "combat.lifecycle",
    data: { state: "started" },
  })}\n`);
}
let sequence = 0;

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 120));
}

function indexedStreams(service: ReadModelService): number {
  const model = service.model();
  if (!model) return 0;
  return model.database.query<{ count: number }, []>("select count(*) as count from indexed_streams").get()?.count ?? 0;
}

function lastIndexedAt(service: ReadModelService): string {
  const model = service.model();
  if (!model) return "";
  return model.database
    .query<{ latest: string }, []>("select coalesce(max(indexed_at), '') as latest from indexed_streams")
    .get()?.latest ?? "";
}

function offset(service: ReadModelService): number {
  const model = service.model();
  if (!model) return 0;
  return model.database
    .query<{ total: number }, []>("select coalesce(sum(byte_offset), 0) as total from indexed_streams")
    .get()?.total ?? 0;
}

describe("read model service", () => {
  test("refuses to finalize the session that is still being captured", async () => {
    const context = await workspace();
    try {
      await setCurrent(context.logDirectory, SESSION);
      const service = await createReadModelService({ logDirectory: context.logDirectory });
      try {
        expect(await service.indexSession(SESSION, "combat", { finalize: true }))
          .toMatchObject({ finalized: false });
        expect(await service.indexSession(OTHER, "combat", { finalize: true }))
          .toMatchObject({ finalized: true });
      } finally {
        await service.close();
      }
    } finally {
      await context.cleanup();
    }
  }, 20_000);

  test("serialises concurrent passes instead of interleaving them", async () => {
    const context = await workspace();
    try {
      const service = await createReadModelService({ logDirectory: context.logDirectory });
      try {
        const results = await Promise.all([
          service.indexSession(SESSION, "combat"),
          service.indexSession(SESSION, "combat"),
          service.indexSession(OTHER, "combat"),
        ]);
        for (const result of results) expect(result.ok).toBe(true);
      } finally {
        await service.close();
      }
    } finally {
      await context.cleanup();
    }
  });

  test("does not rewrite progress while the active stream is quiet", async () => {
    const context = await workspace();
    try {
      await setCurrent(context.logDirectory, SESSION);
      await appendRecord(context.logDirectory, SESSION);
      const service = await createReadModelService({ logDirectory: context.logDirectory, indexIntervalMs: 10 });
      try {
        const release = service.acquire();
        await settle();
        const indexedAt = lastIndexedAt(service);
        expect(indexedAt).not.toBe("");

        await settle();
        expect(lastIndexedAt(service)).toBe(indexedAt);

        await appendRecord(context.logDirectory, SESSION);
        await settle();
        expect(lastIndexedAt(service)).not.toBe(indexedAt);
        release();
      } finally {
        await service.close();
      }
    } finally {
      await context.cleanup();
    }
  });

  test("runs the periodic pass only while a consumer is registered", async () => {
    const context = await workspace();
    try {
      await setCurrent(context.logDirectory, SESSION);
      await appendRecord(context.logDirectory, SESSION);
      const service = await createReadModelService({ logDirectory: context.logDirectory, indexIntervalMs: 10 });
      try {
        await settle();
        expect(indexedStreams(service)).toBe(0);

        const release = service.acquire();
        await settle();
        expect(indexedStreams(service)).toBeGreaterThan(0);

        const second = service.acquire();
        release();
        release();
        const held = offset(service);
        await appendRecord(context.logDirectory, SESSION);
        await settle();
        expect(offset(service)).toBeGreaterThan(held);

        second();
        await settle();
        const idle = offset(service);
        await appendRecord(context.logDirectory, SESSION);
        await settle();
        expect(offset(service)).toBe(idle);
      } finally {
        await service.close();
      }
    } finally {
      await context.cleanup();
    }
  });

  test("stops indexing once closed", async () => {
    const context = await workspace();
    try {
      const service = await createReadModelService({ logDirectory: context.logDirectory });
      await service.close();
      expect(await service.indexSession(SESSION, "combat")).toMatchObject({ ok: false });
      expect(service.model()).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });
});
