import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createReadModelService } from "./read-model-service.ts";

const SESSION = "20260101T000000000Z-0000abcd";
const OTHER = "20260101T010000000Z-0000beef";

async function workspace(): Promise<{ logDirectory: string; cleanup: () => Promise<void> }> {
  const logDirectory = await mkdtemp(path.join(tmpdir(), "spiritvale-readmodel-"));
  for (const id of [SESSION, OTHER]) {
    await mkdir(path.join(logDirectory, "sessions", id), { recursive: true });
    await writeFile(path.join(logDirectory, "sessions", id, "combat.jsonl"), "");
  }
  return { logDirectory, cleanup: () => rm(logDirectory, { recursive: true, force: true }) };
}

/** Points the shared "current stream" file at a session, the way an active capture would. */
async function setCurrent(logDirectory: string, sessionId: string): Promise<void> {
  await mkdir(path.join(logDirectory, "current"), { recursive: true });
  await writeFile(
    path.join(logDirectory, "current", "combat.json"),
    JSON.stringify({
      schemaVersion: 1,
      stream: "combat",
      sessionId,
      startedAt: new Date().toISOString(),
      relativePath: path.join("sessions", sessionId, "combat.jsonl"),
    }),
  );
}

describe("read model service", () => {
  test("refuses to finalize the session that is still being captured", async () => {
    const context = await workspace();
    try {
      await setCurrent(context.logDirectory, SESSION);
      const service = await createReadModelService({ logDirectory: context.logDirectory });
      try {
        // The live log can still grow, so its trailing encounter must stay open however it is asked.
        expect(await service.indexSession(SESSION, "combat", { finalize: true }))
          .toMatchObject({ finalized: false });
        // A different session is finished and may be closed out.
        expect(await service.indexSession(OTHER, "combat", { finalize: true }))
          .toMatchObject({ finalized: true });
      } finally {
        await service.close();
      }
    } finally {
      await context.cleanup();
    }
  });

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
        // All complete; the point is that none throws or corrupts the shared database by overlapping.
        for (const result of results) expect(result.ok).toBe(true);
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
