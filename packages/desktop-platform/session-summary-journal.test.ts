import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    journal.ensure("session", "combat", { persist: true, calculate }),
    journal.ensure("session", "combat", { persist: true, calculate }),
  ]);
  expect(first).toEqual(second);
  expect(calculations).toBe(1);
  expect((await readFile(path.join(root, "summary.jsonl"), "utf8")).trim().split(/\r?\n/)).toHaveLength(1);

  await journal.ensure("session", "combat", { persist: true, calculate });
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

  await journal.append("active", "combat", { recordCount: 2, summary: "final" });
  await journal.append("active", "combat", { recordCount: 3, summary: "repaired" });
  expect(journal.get("active", "combat")).toEqual({ recordCount: 3, summary: "repaired" });
  expect((await readFile(path.join(root, "summary.jsonl"), "utf8")).trim().split(/\r?\n/)).toHaveLength(2);
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "spiritvale-summary-journal-"));
  temporaryRoots.push(root);
  return root;
}
