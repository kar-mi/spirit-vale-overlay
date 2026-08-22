import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { claimBackendOwner, releaseBackendOwner } from "./backend-owner.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("Neutralino backend ownership", () => {
  test("permits one live owner and releases only for that owner", () => {
    const file = ownerFile();
    expect(claimBackendOwner(file, 101, (pid) => pid === 101)).toBeTrue();
    expect(claimBackendOwner(file, 202, (pid) => pid === 101)).toBeFalse();
    releaseBackendOwner(file, 202);
    expect(claimBackendOwner(file, 303, (pid) => pid === 101)).toBeFalse();
    releaseBackendOwner(file, 101);
    expect(claimBackendOwner(file, 303, () => false)).toBeTrue();
  });

  test("replaces a stale owner", () => {
    const file = ownerFile();
    expect(claimBackendOwner(file, 101, () => false)).toBeTrue();
    expect(claimBackendOwner(file, 202, () => false)).toBeTrue();
  });
});

function ownerFile(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "neutralino-owner-"));
  roots.push(root);
  return path.join(root, "owner.json");
}
