import { appendFileSync } from "node:fs";
import path from "node:path";

export interface HumanReadableErrorEntry {
  title: string;
  reason: string;
  details?: Readonly<Record<string, string | number | boolean | undefined>>;
}

/**
 * A small, independent fallback log for failures that may prevent the structured session logs
 * from being created or written. Error paths use a synchronous append so the explanation reaches
 * disk before capture teardown or application shutdown can begin.
 */
export class HumanReadableErrorLog {
  readonly path: string;

  constructor(rootDirectory: string) {
    this.path = path.join(rootDirectory, "error.log");
  }

  write(entry: HumanReadableErrorEntry): void {
    try {
      appendFileSync(this.path, formatEntry(entry), "utf8");
    } catch (error) {
      // This logger is the last-resort diagnostic path. Never let its own failure interrupt capture.
      const message = error instanceof Error ? error.message : String(error);
      console.error("[spiritvale-error-log]", `Could not write ${this.path}: ${message}`);
    }
  }
}

export function formatEntry(entry: HumanReadableErrorEntry, recordedAt = new Date()): string {
  const title = sentence(entry.title, "Spirit Vale encountered an error");
  const reason = readableValue(entry.reason, "No reason was provided.");
  const lines = [`[${recordedAt.toISOString()}] ${title}`, `Reason: ${reason}`];
  for (const [label, value] of Object.entries(entry.details ?? {})) {
    if (value === undefined) continue;
    lines.push(`${label}: ${readableValue(String(value), "Unknown")}`);
  }
  return `${lines.join("\n")}\n\n`;
}

function sentence(value: string, fallback: string): string {
  const readable = readableValue(value, fallback).replace(/[.!?]+$/, "");
  return `${readable}.`;
}

function readableValue(value: string, fallback: string): string {
  const normalized = value.trim().replace(/\r\n?/g, "\n");
  if (!normalized) return fallback;
  return normalized.split("\n").join("\n  ");
}
