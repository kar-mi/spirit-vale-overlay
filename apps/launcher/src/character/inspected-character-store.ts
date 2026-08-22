import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import type { InspectedCharacter } from "@kar-mi/spirit-vale-tools-character";

import { normalizeCharacterSnapshot, sanitizeCharacterSnapshot } from "./storage.ts";

interface StoredInspectedCharacter {
  name: string;
  inspectedAt: string;
  snapshot: string;
}

export class InspectedCharacterStore {
  private readonly database: Database;

  constructor(file: string) {
    if (file !== ":memory:") {
      const directory = path.dirname(file);
      if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
    }
    this.database = new Database(file);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS inspected_characters (
        name TEXT PRIMARY KEY COLLATE NOCASE,
        class_name TEXT NOT NULL,
        level INTEGER NOT NULL,
        inspected_at TEXT NOT NULL,
        snapshot TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS inspected_characters_recent
        ON inspected_characters (inspected_at DESC);
    `);
  }

  upsert(entry: InspectedCharacter): void {
    const snapshot = sanitizeCharacterSnapshot(entry.snapshot);
    const cls = snapshot.archetypes.at(-1) ?? "";
    this.database.query(`
      INSERT INTO inspected_characters (name, class_name, level, inspected_at, snapshot)
      VALUES ($name, $class_name, $level, $inspected_at, $snapshot)
      ON CONFLICT(name) DO UPDATE SET
        name = excluded.name,
        class_name = excluded.class_name,
        level = excluded.level,
        inspected_at = excluded.inspected_at,
        snapshot = excluded.snapshot
    `).run({
      $name: snapshot.name,
      $class_name: cls,
      $level: snapshot.level,
      $inspected_at: entry.inspectedAt,
      $snapshot: JSON.stringify(snapshot),
    });
  }

  list(search = ""): InspectedCharacter[] {
    const trimmed = search.trim();
    const rows = trimmed
      ? this.database.query<StoredInspectedCharacter, { $pattern: string }>(`
          SELECT name, inspected_at AS inspectedAt, snapshot
          FROM inspected_characters
          WHERE name LIKE $pattern ESCAPE '\\' COLLATE NOCASE OR class_name LIKE $pattern ESCAPE '\\' COLLATE NOCASE
          ORDER BY inspected_at DESC, name COLLATE NOCASE
        `).all({ $pattern: `%${escapeLike(trimmed)}%` })
      : this.database.query<StoredInspectedCharacter, Record<string, never>>(`
          SELECT name, inspected_at AS inspectedAt, snapshot
          FROM inspected_characters
          ORDER BY inspected_at DESC, name COLLATE NOCASE
        `).all({});
    return rows.flatMap((row) => decodeRow(row));
  }

  delete(name: string): boolean {
    return this.database.query("DELETE FROM inspected_characters WHERE name = $name COLLATE NOCASE").run({ $name: name }).changes > 0;
  }

  clear(): void { this.database.exec("DELETE FROM inspected_characters"); }

  close(): void { this.database.close(); }
}

function decodeRow(row: StoredInspectedCharacter): InspectedCharacter[] {
  try {
    const snapshot = normalizeCharacterSnapshot(JSON.parse(row.snapshot), { requireCurrentBuildFingerprint: false });
    return snapshot ? [{ snapshot, inspectedAt: row.inspectedAt }] : [];
  } catch {
    return [];
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
