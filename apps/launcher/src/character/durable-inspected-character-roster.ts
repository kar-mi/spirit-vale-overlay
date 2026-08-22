import { normalizeName } from "@kar-mi/spirit-vale-tools-combat";
import type { InspectedCharacter } from "@kar-mi/spirit-vale-tools-character";

export interface InspectedCharacterPersistence {
  list(): InspectedCharacter[];
  upsert(entry: InspectedCharacter): void;
  delete(name: string): boolean;
  clear(): void;
  close(): void;
}

export interface DurableInspectedCharacterRosterOptions {
  onPersistenceError?: (error: unknown | undefined) => void;
}

export class DurableInspectedCharacterRoster {
  private readonly entries = new Map<string, InspectedCharacter>();
  private readonly listeners = new Set<() => void>();
  private readonly pendingUpserts = new Map<string, InspectedCharacter>();
  private readonly pendingDeletes = new Map<string, string>();
  private pendingClear = false;

  constructor(
    private readonly persistence: InspectedCharacterPersistence,
    private readonly options: DurableInspectedCharacterRosterOptions = {},
  ) {
    try {
      for (const entry of persistence.list()) this.entries.set(characterKey(entry.snapshot.name), structuredClone(entry));
    } catch (error) {
      this.reportPersistenceError(error);
    }
  }

  list(): InspectedCharacter[] {
    return [...this.entries.values()]
      .sort((left, right) => right.inspectedAt.localeCompare(left.inspectedAt)
        || left.snapshot.name.localeCompare(right.snapshot.name, undefined, { sensitivity: "accent" }))
      .map((entry) => structuredClone(entry));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  ingest(roster: readonly InspectedCharacter[]): void {
    let changed = false;
    for (const candidate of roster) {
      const key = characterKey(candidate.snapshot.name);
      const current = this.entries.get(key);
      if (current && candidate.inspectedAt < current.inspectedAt) continue;
      if (current && sameEntry(current, candidate)) continue;
      const entry = structuredClone(candidate);
      this.entries.set(key, entry);
      this.pendingDeletes.delete(key);
      this.pendingUpserts.set(key, entry);
      changed = true;
    }

    // Notify observers before synchronous SQLite work.
    if (changed) this.publish();
    this.flushPending();
  }

  delete(name: string): boolean {
    const key = characterKey(name);
    const current = this.entries.get(key);
    if (!current) return false;
    this.entries.delete(key);
    this.pendingUpserts.delete(key);
    this.pendingDeletes.set(key, current.snapshot.name);
    this.publish();
    this.flushPending();
    return true;
  }

  clear(): void {
    if (!this.entries.size && !this.pendingUpserts.size && !this.pendingDeletes.size) return;
    this.entries.clear();
    this.pendingUpserts.clear();
    this.pendingDeletes.clear();
    this.pendingClear = true;
    this.publish();
    this.flushPending();
  }

  close(): void {
    this.flushPending();
    this.persistence.close();
  }

  private flushPending(): void {
    let failure: unknown | undefined;

    if (this.pendingClear) {
      try {
        this.persistence.clear();
        this.pendingClear = false;
      } catch (error) {
        failure = error;
      }
    }

    if (!this.pendingClear) {
      for (const [key, name] of this.pendingDeletes) {
        try {
          this.persistence.delete(name);
          this.pendingDeletes.delete(key);
        } catch (error) {
          failure ??= error;
        }
      }
      for (const [key, entry] of this.pendingUpserts) {
        try {
          this.persistence.upsert(entry);
          if (this.pendingUpserts.get(key) === entry) this.pendingUpserts.delete(key);
        } catch (error) {
          failure ??= error;
        }
      }
    }

    this.reportPersistenceError(failure);
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }

  private reportPersistenceError(error: unknown | undefined): void {
    try {
      this.options.onPersistenceError?.(error);
    } catch {
      // Storage reporting must never interrupt capture or roster publication.
    }
  }
}

function characterKey(name: string): string {
  return normalizeName(name);
}

function sameEntry(left: InspectedCharacter, right: InspectedCharacter): boolean {
  return left.inspectedAt === right.inspectedAt
    && left.snapshot.updatedAt === right.snapshot.updatedAt
    && left.snapshot.name === right.snapshot.name;
}
