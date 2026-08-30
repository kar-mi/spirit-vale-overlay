import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadSessionSummaryJournal } from "./session-summary-journal.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("loads valid rows, ignores malformed rows, and lets the latest duplicate win", async () => {
  const root = await temporaryRoot();
  await writeFile(path.join(root, "summary.jsonl"), [
    JSON.stringify({ schemaVersion: 1, sessionId: "one", stream: "combat", recordCount: 2, summary: "old" }),
    "{interrupted",
    JSON.stringify({ schemaVersion: 1, sessionId: "one", stream: "rewards", recordCount: 3, summary: "rewards" }),
    JSON.stringify({ schemaVersion: 1, sessionId: "one", stream: "combat", recordCount: 4, summary: "new", locations: [{ kind: "map", mapId: 17 }] }),
    JSON.stringify({ schemaVersion: 99, sessionId: "ignored", stream: "combat", recordCount: 1, summary: "invalid" }),
    "",
  ].join("\n"), "utf8");

  const journal = await loadSessionSummaryJournal(root);
  expect(journal.get("one", "combat")).toEqual({ recordCount: 4, summary: "new", locations: [{ kind: "map", mapId: 17 }] });
  expect(journal.get("one", "rewards")).toEqual({ recordCount: 3, summary: "rewards" });
  expect(journal.get("ignored", "combat")).toBeUndefined();
});

test("calculates missing completed summaries once and appends them for reuse", async () => {
  const root = await temporaryRoot();
  const journal = await loadSessionSummaryJournal(root);
  let calculations = 0;
  const calculate = async () => {
    calculations += 1;
    return { recordCount: 5, summary: "calculated" };
  };

  const [first, second] = await Promise.all([
    journal.ensure("session", "combat", { persist: true, createdAt: "2026-01-01T00:00:00.000Z", calculate }),
    journal.ensure("session", "combat", { persist: true, createdAt: "2026-01-01T00:00:00.000Z", calculate }),
  ]);
  expect(first).toEqual(second);
  expect(calculations).toBe(1);
  expect((await readFile(path.join(root, "summary.jsonl"), "utf8")).trim().split(/\r?\n/)).toHaveLength(1);

  await journal.ensure("session", "combat", { persist: true, createdAt: "2026-01-01T00:00:00.000Z", calculate });
  expect(calculations).toBe(1);
});

test("does not persist active calculations and allows finalization to append a newer result", async () => {
  const root = await temporaryRoot();
  const journal = await loadSessionSummaryJournal(root);
  await journal.ensure("active", "combat", {
    persist: false,
    calculate: async () => ({ recordCount: 1, summary: "in progress" }),
  });
  expect(journal.get("active", "combat")).toBeUndefined();

  await journal.append("active", "combat", { recordCount: 2, summary: "final" }, "2026-01-01T00:00:00.000Z");
  await journal.append("active", "combat", { recordCount: 3, summary: "repaired" }, "2026-01-01T00:00:00.000Z");
  expect(journal.get("active", "combat")).toEqual({ recordCount: 3, summary: "repaired" });
  expect((await readFile(path.join(root, "summary.jsonl"), "utf8")).trim().split(/\r?\n/)).toHaveLength(2);
});

test("indexes session metadata once and applies date ranges before the limit", async () => {
  const root = await temporaryRoot();
  await writeSession(root, "old", "2026-01-01T10:00:00.000Z");
  await writeSession(root, "middle", "2026-02-01T10:00:00.000Z");
  await writeSession(root, "new", "2026-03-01T10:00:00.000Z");
  const journal = await loadSessionSummaryJournal(root);
  for (const [id, createdAt] of [
    ["old", "2026-01-01T10:00:00.000Z"],
    ["middle", "2026-02-01T10:00:00.000Z"],
    ["new", "2026-03-01T10:00:00.000Z"],
  ] as const) {
    await journal.append(id, "combat", { recordCount: 1, summary: id }, createdAt);
  }

  const listed = await journal.list("combat", {
    limit: 1,
    dateRange: { fromMs: Date.parse("2026-01-15T00:00:00.000Z"), toMs: Date.parse("2026-02-15T00:00:00.000Z") },
  });
  expect(listed.map(({ id }) => id)).toEqual(["middle"]);
  expect(listed[0]?.cachedSummary).toEqual({ recordCount: 1, summary: "middle" });

  const persisted = await readFile(path.join(root, "summary.jsonl"), "utf8");
  expect(persisted).toContain('"kind":"checkpoint"');
});

test("reconciles externally added and removed files when the stream directory changes", async () => {
  const root = await temporaryRoot();
  await writeSession(root, "first", "2026-01-01T00:00:00.000Z");
  const journal = await loadSessionSummaryJournal(root);
  expect((await journal.list("combat", { limit: 10 })).map(({ id }) => id)).toEqual(["first"]);

  await Bun.sleep(10);
  await writeSession(root, "second", "2026-02-01T00:00:00.000Z");
  await rm(path.join(root, "combat", "first.jsonl"));
  expect((await journal.list("combat", { limit: 10 })).map(({ id }) => id)).toEqual(["second"]);

  const persisted = await readFile(path.join(root, "summary.jsonl"), "utf8");
  expect(persisted).toContain('"kind":"deleted","sessionId":"first"');
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "spiritvale-summary-journal-"));
  temporaryRoots.push(root);
  return root;
}

async function writeSession(root: string, sessionId: string, startedAt: string): Promise<void> {
  const directory = path.join(root, "combat");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${sessionId}.jsonl`), `${JSON.stringify({
    schemaVersion: 2,
    stream: "combat",
    sessionId,
    producer: "test",
    startedAt,
  })}\n`, "utf8");
}
