import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { sessionStreamPath } from "@kar-mi/spirit-vale-tools-logging";

import { createBoundedLogSession } from "./bounded-log-session.ts";

describe("bounded log session", () => {
  test("flush makes a pending batch durable without closing the session", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-bounded-log-"));
    try {
      const session = await createBoundedLogSession({
        producer: "test",
        streams: ["combat"],
        logDirectory: directory,
      });
      const logger = session.logger("combat");
      logger.log("combat.lifecycle", { state: "started" });
      logger.log("combat.lifecycle", { state: "stopped" });

      await logger.flush();

      const content = await readFile(sessionStreamPath(session.id, "combat", directory), "utf8");
      const records = content.trim().split("\n").map((line) => JSON.parse(line));
      expect(records.map((record) => record.sequence)).toEqual([1, 2]);
      expect(records.map((record) => record.data.state)).toEqual(["started", "stopped"]);
      await session.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("close flushes every stream's last partial batch", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "spiritvale-bounded-close-"));
    try {
      const session = await createBoundedLogSession({
        producer: "test",
        streams: ["combat", "rewards", "market"],
        logDirectory: directory,
      });
      session.logger("combat").log("combat.lifecycle", { state: "stopped" });
      session.logger("rewards").log("rewards.lifecycle", { state: "stopped" });
      session.logger("market").log("market.lifecycle", { state: "stopped" });

      await session.close();

      for (const stream of ["combat", "rewards", "market"] as const) {
        expect(await readFile(sessionStreamPath(session.id, stream, directory), "utf8")).toContain(`\"${stream}.lifecycle\"`);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
