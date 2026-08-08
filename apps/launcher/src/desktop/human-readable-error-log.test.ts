import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { formatEntry, HumanReadableErrorLog } from "./human-readable-error-log.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("HumanReadableErrorLog", () => {
  test("appends readable entries to error.log at the supplied root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spiritvale-error-log-"));
    directories.push(root);
    const log = new HumanReadableErrorLog(root);

    log.write({
      title: "Capture could not start",
      reason: "Npcap did not report a usable network adapter",
      details: { "Network adapter": "Automatic selection" },
    });
    log.write({ title: "Packet capture stopped unexpectedly", reason: "Npcap capture failed: device disconnected" });

    expect(log.path).toBe(path.join(root, "error.log"));
    const contents = await readFile(log.path, "utf8");
    expect(contents).toContain("Capture could not start.\nReason: Npcap did not report a usable network adapter");
    expect(contents).toContain("Network adapter: Automatic selection");
    expect(contents).toContain("Packet capture stopped unexpectedly.\nReason: Npcap capture failed: device disconnected");
  });

  test("indents multiline reasons so entries remain easy to scan", () => {
    const entry = formatEntry(
      { title: "Capture failed", reason: "First line\r\nSecond line" },
      new Date("2026-08-02T12:34:56.789Z"),
    );
    expect(entry).toBe("[2026-08-02T12:34:56.789Z] Capture failed.\nReason: First line\n  Second line\n\n");
  });
});
