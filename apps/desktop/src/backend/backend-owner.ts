import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

export function claimBackendOwner(
  file: string,
  pid = process.pid,
  isAlive: (candidate: number) => boolean = processIsAlive,
): boolean {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = openSync(file, "wx");
      try { writeFileSync(handle, JSON.stringify({ pid })); } finally { closeSync(handle); }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = readOwner(file);
      if (owner !== undefined && owner !== pid && isAlive(owner)) return false;
      try { unlinkSync(file); } catch {}
    }
  }
  return false;
}

export function releaseBackendOwner(file: string, pid = process.pid): void {
  if (readOwner(file) !== pid) return;
  try { unlinkSync(file); } catch {}
}

function readOwner(file: string): number | undefined {
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as { pid?: unknown };
    return typeof value.pid === "number" ? value.pid : undefined;
  } catch {
    return undefined;
  }
}

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
