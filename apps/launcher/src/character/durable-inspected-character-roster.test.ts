import { describe, expect, test } from "bun:test";
import type { CharacterSnapshot, InspectedCharacter } from "@kar-mi/spirit-vale-tools-character";
import { CURRENT_GAME_BUILD_FINGERPRINT } from "@kar-mi/spirit-vale-tools-capture";

import {
  DurableInspectedCharacterRoster,
  type InspectedCharacterPersistence,
} from "./durable-inspected-character-roster.ts";

describe("durable inspected character roster", () => {
  test("hydrates saved entries and publishes a live inspection before persisting it", () => {
    const events: string[] = [];
    const persistence = new FakePersistence([entry("Saved", "2026-08-10T12:00:00.000Z")], events);
    const roster = new DurableInspectedCharacterRoster(persistence);
    roster.subscribe(() => events.push(`publish:${roster.list()[0]?.snapshot.name}`));

    roster.ingest([entry("Live", "2026-08-11T12:00:00.000Z")]);

    expect(roster.list().map(({ snapshot }) => snapshot.name)).toEqual(["Live", "Saved"]);
    expect(events).toEqual(["publish:Live", "upsert:Live"]);
  });

  test("persists only changed entries from full capture-roster publications", () => {
    const events: string[] = [];
    const persistence = new FakePersistence([], events);
    const roster = new DurableInspectedCharacterRoster(persistence);
    const first = entry("First", "2026-08-10T12:00:00.000Z");
    const second = entry("Second", "2026-08-11T12:00:00.000Z");

    roster.ingest([first]);
    events.length = 0;
    roster.ingest([first]);
    expect(events).toEqual([]);

    roster.ingest([second, first]);
    expect(events).toEqual(["upsert:Second"]);
  });

  test("does not replace a newer saved inspection with an older capture entry", () => {
    const events: string[] = [];
    const persistence = new FakePersistence([entry("Player", "2026-08-11T12:00:00.000Z")], events);
    const roster = new DurableInspectedCharacterRoster(persistence);

    roster.ingest([entry("Player", "2026-08-10T12:00:00.000Z")]);

    expect(roster.list()[0]?.inspectedAt).toBe("2026-08-11T12:00:00.000Z");
    expect(events).toEqual([]);
  });

  test("keeps live entries visible, continues later writes and retries a failed write", () => {
    const events: string[] = [];
    const warnings: Array<unknown | undefined> = [];
    const persistence = new FakePersistence([], events);
    persistence.failUpsertOnce.add("First");
    const roster = new DurableInspectedCharacterRoster(persistence, {
      onPersistenceError: (error) => warnings.push(error),
    });
    let published: string[] = [];
    roster.subscribe(() => { published = roster.list().map(({ snapshot }) => snapshot.name); });
    const first = entry("First", "2026-08-10T12:00:00.000Z");
    const second = entry("Second", "2026-08-11T12:00:00.000Z");

    roster.ingest([second, first]);

    expect(published).toEqual(["Second", "First"]);
    expect(events).toEqual(["upsert:Second", "upsert:First:failed"]);
    expect(persistence.entries.map(({ snapshot }) => snapshot.name)).toEqual(["Second"]);
    expect(warnings.at(-1)).toBeInstanceOf(Error);

    events.length = 0;
    roster.ingest([second, first]);
    expect(events).toEqual(["upsert:First"]);
    expect(persistence.entries.map(({ snapshot }) => snapshot.name).sort()).toEqual(["First", "Second"]);
    expect(warnings.at(-1)).toBeUndefined();
  });

  test("updates the cache and persistence for case-insensitive delete and clear", () => {
    const events: string[] = [];
    const persistence = new FakePersistence([
      entry("Alpha", "2026-08-10T12:00:00.000Z"),
      entry("Beta", "2026-08-11T12:00:00.000Z"),
    ], events);
    const roster = new DurableInspectedCharacterRoster(persistence);
    let publications = 0;
    roster.subscribe(() => { publications += 1; });

    expect(roster.delete("ALPHA")).toBe(true);
    expect(roster.list().map(({ snapshot }) => snapshot.name)).toEqual(["Beta"]);
    expect(persistence.entries.map(({ snapshot }) => snapshot.name)).toEqual(["Beta"]);
    roster.clear();
    expect(roster.list()).toEqual([]);
    expect(persistence.entries).toEqual([]);
    expect(publications).toBe(2);
  });
});

class FakePersistence implements InspectedCharacterPersistence {
  readonly failUpsertOnce = new Set<string>();

  constructor(public entries: InspectedCharacter[], private readonly events: string[]) {}

  list(): InspectedCharacter[] { return structuredClone(this.entries); }

  upsert(candidate: InspectedCharacter): void {
    const name = candidate.snapshot.name;
    if (this.failUpsertOnce.delete(name)) {
      this.events.push(`upsert:${name}:failed`);
      throw new Error(`failed to save ${name}`);
    }
    this.events.push(`upsert:${name}`);
    const key = name.toLocaleLowerCase();
    this.entries = [...this.entries.filter((entry) => entry.snapshot.name.toLocaleLowerCase() !== key), structuredClone(candidate)];
  }

  delete(name: string): boolean {
    const key = name.toLocaleLowerCase();
    const length = this.entries.length;
    this.entries = this.entries.filter((entry) => entry.snapshot.name.toLocaleLowerCase() !== key);
    return this.entries.length !== length;
  }

  clear(): void { this.entries = []; }

  close(): void {}
}

function entry(name: string, inspectedAt: string): InspectedCharacter {
  return { snapshot: snapshot(name), inspectedAt };
}

function snapshot(name: string): CharacterSnapshot {
  return {
    schemaVersion: 1,
    buildFingerprint: CURRENT_GAME_BUILD_FINGERPRINT,
    name,
    archetypes: ["Mage"],
    level: 20,
    experience: 0,
    jobLevel: 1,
    jobExperience: 0,
    attributes: { STR: 1, VIT: 1, AGI: 1, DEX: 1, INT: 1, LUK: 1 },
    activeLoadout: "Normal",
    equipment: [],
    artifacts: [],
    skills: [],
    updatedAt: inspectedAtForSnapshot,
    source: "live",
  };
}

const inspectedAtForSnapshot = "2026-08-11T12:00:00.000Z";
