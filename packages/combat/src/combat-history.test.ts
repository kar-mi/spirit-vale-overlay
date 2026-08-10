import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { openReadModel } from "@kar-mi/spirit-vale-tools-sqlite";
import { createCombatDomain, indexCombatStream } from "@kar-mi/spirit-vale-tools-combat";

import { indexCombatSession } from "./combat-history.ts";
import type { CombatReadModelSource } from "./combat-history.ts";

const SESSION = "20260101T000000000Z-0000abcd";
const ORIGIN = Date.UTC(2026, 0, 1);
const IDLE_GAP_MS = 30_000;

/** One encounter per entry: each is a lone hit, spaced past the idle gap from the last. */
function log(encounters: number): string {
  let sequence = 0;
  const line = (atMs: number, data: Record<string, unknown>, type = "combat.event"): string =>
    `${JSON.stringify({
      schemaVersion: 1, sessionId: SESSION, sequence: ++sequence,
      recordedAt: new Date(ORIGIN + atMs).toISOString(), source: "test", type, data,
    })}\n`;

  let text = line(0, { kind: "actorIdentity", operation: "upsert", tick: 0, actorId: 1, displayName: "Aurora" }, "combat.actorIdentity");
  for (let index = 0; index < encounters; index += 1) {
    const atMs = index * (IDLE_GAP_MS * 2);
    text += line(atMs, {
      kind: "damage", tick: atMs, actorId: 1, targetId: 90 + index, team: 0, value: index + 1,
      sourceId: "skill:hit", sourceLabel: "Hit", hitResult: "normal",
    });
  }
  return text;
}

async function fixture(encounters: number): Promise<{ source: CombatReadModelSource; cleanup: () => Promise<void> }> {
  const logDirectory = await mkdtemp(path.join(tmpdir(), "spiritvale-history-"));
  const sourcePath = path.join(logDirectory, "combat", `${SESSION}.jsonl`);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, log(encounters));

  const model = await openReadModel({ logDirectory, domains: [createCombatDomain()] });
  await indexCombatStream(model, { sessionId: SESSION, sourcePath, finalize: true });

  return {
    source: { model: () => model, indexSession: async () => ({ ok: true }) },
    cleanup: async () => {
      model.close();
      await rm(logDirectory, { recursive: true, force: true });
    },
  };
}

describe("indexCombatSession", () => {
  test("keeps the newest encounters when the log has more than the cap", async () => {
    const context = await fixture(8);
    try {
      const all = await indexCombatSession(context.source, SESSION, 100);
      expect(all?.encounters).toHaveLength(8);
      expect(all?.omitted).toBe(0);

      const capped = await indexCombatSession(context.source, SESSION, 3);
      expect(capped?.encounters).toHaveLength(3);
      expect(capped?.omitted).toBe(5);

      // Encounters come back oldest first, so the retained three must be the last three of the full
      // list — the view defaults its selection to the final entry, which has to be the most recent.
      expect(capped?.encounters.map((entry) => entry.encounterId))
        .toEqual(all!.encounters.slice(-3).map((entry) => entry.encounterId));
    } finally {
      await context.cleanup();
    }
  });

  test("pages past the keyset page size to see every encounter", async () => {
    // More encounters than one page, so the enumeration has to follow the cursor.
    const context = await fixture(600);
    try {
      const indexed = await indexCombatSession(context.source, SESSION, 10_000);
      expect(indexed?.encounters).toHaveLength(600);
      expect(indexed?.omitted).toBe(0);
    } finally {
      await context.cleanup();
    }
  });

  test("gives up when the pass fails, leaving the caller to replay the file", async () => {
    const context = await fixture(1);
    try {
      const failing: CombatReadModelSource = {
        model: context.source.model,
        indexSession: async () => ({ ok: false }),
      };
      expect(await indexCombatSession(failing, SESSION, 100)).toBeUndefined();
      expect(await indexCombatSession(undefined, SESSION, 100)).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });
});
