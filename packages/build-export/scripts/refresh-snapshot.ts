/**
 * Regenerates `src/catalog/snapshot.json` — the pinned catalog snapshot the build exporter
 * translates against. Run it after a game patch that adds skills, classes or equipment:
 *
 *   bun run --filter @spiritvale/build-export refresh-snapshot
 *   bun run --filter @spiritvale/build-export refresh-snapshot -- --site-dir ../spiritvale-deploy
 *
 * WHY A SNAPSHOT AND NOT A RUNTIME FETCH
 * The overlay is otherwise fully offline with bundled catalogs, so a network dependency at export
 * time would be the only one in the app and would fail in exactly the situation a player is most
 * likely to hit (alt-tabbed, offline, or the site down).
 *
 * WHY THESE FIELDS AND NOTHING ELSE
 * The v:2 build format is defined by spiritvalers.com, not by the game, so translation needs the
 * site's identifier scheme. Almost all of it is already derivable from the game export that
 * `@kar-mi/spirit-vale-tools-items` ships, so this snapshot deliberately carries ONLY the parts
 * that are not:
 *
 *   - skill route slugs. 68 of 258 are editorial rather than mechanical
 *     (`IncreasedManaRegen` -> `increased-recovery`), so they cannot be derived from the game id.
 *   - class slugs and their advancement graph.
 *   - the StatType number -> site stat-key vocabulary.
 *   - per-item card-slot counts and equipment slot (the slot picks the substat pool).
 *   - substat pool values.
 *   - id membership lists, so an unrecognised item is reported rather than written into a build
 *     the planner would silently reject.
 *
 * Item names, descriptions, stat blocks, drop tables and icons are NOT copied. That keeps the file
 * small (~48 KB against ~508 KB for the raw catalogs), keeps it stable across patches that only
 * touch item numbers, and keeps it inside the Interoperability Snapshot grant in the site's
 * LICENSE, which permits vendoring this derived subset but not the catalogs themselves.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ATTRIBUTION, type BuildExportSnapshot } from "../src/snapshot-types.ts";

const DEFAULT_ORIGIN = "https://spiritvalers.com";
const OUTPUT = path.join(import.meta.dir, "..", "src", "catalog", "snapshot.json");

interface SiteEquip {
  id: string;
  slot: string;
  cardSlots?: number;
  substatPool?: string;
}
interface SiteSkill { id: string; gameId?: string }
interface SiteClass {
  slug: string;
  gameId: string;
  type: string;
  maxJobLevel: number;
  advancedClasses?: string[];
  skills?: SiteSkill[];
}

const args = process.argv.slice(2);
const siteDir = flag("--site-dir");
const origin = flag("--site") ?? DEFAULT_ORIGIN;

const [equipment, cards, gems, artifacts, pools, classDoc, statTypes, gameInfo] = await Promise.all([
  load<SiteEquip[]>("equip-configs.json"),
  load<Array<{ id: string }>>("card-configs.json"),
  load<Array<{ id: string }>>("gem-configs.json"),
  load<Array<{ id: string }>>("artifact-configs.json"),
  load<Record<string, unknown>>("substat-pools.json"),
  load<{ classes: SiteClass[] | Record<string, SiteClass> }>("spiritvale-all-classes.json"),
  load<Record<string, string>>("wiki-data/stat-types.json"),
  load<{ build?: string; label?: string }>("wiki-data/game-info.json"),
]);

const classes = Array.isArray(classDoc.classes) ? classDoc.classes : Object.values(classDoc.classes ?? {});
const worn = equipment.filter((item) => item.slot !== "Grimoire");

const snapshot: BuildExportSnapshot = {
  attribution: ATTRIBUTION,
  generatedAt: new Date().toISOString(),
  gameBuild: gameInfo.build ?? "",
  gameLabel: gameInfo.label ?? "",
  // Provenance only, and never a local path: this file is committed, and `--site-dir` is
  // somebody's checkout. `gameBuild`/`generatedAt` are what actually identify the pull.
  source: siteDir ? "local site checkout" : origin,
  equipment: Object.fromEntries(worn.map((item) => [item.id, {
    slot: item.slot,
    cardSlots: item.cardSlots ?? 0,
    ...(item.substatPool ? { substatPool: item.substatPool } : {}),
  }])),
  grimoires: equipment.filter((item) => item.slot === "Grimoire").map((item) => item.id),
  cards: cards.map((item) => item.id),
  gems: gems.map((item) => item.id),
  artifacts: artifacts.map((item) => item.id),
  statTypes: Object.fromEntries(Object.entries(statTypes).map(([code, name]) => [Number(code), name])),
  pools: pools as BuildExportSnapshot["pools"],
  classes: classes.map((entry) => ({
    slug: entry.slug,
    gameId: entry.gameId,
    type: entry.type,
    maxJobLevel: entry.maxJobLevel,
    advancedClasses: entry.advancedClasses ?? [],
    skills: (entry.skills ?? []).map((skill) => ({
      id: skill.id,
      ...(skill.gameId ? { gameId: skill.gameId } : {}),
    })),
  })),
};

await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

const bytes = Buffer.byteLength(JSON.stringify(snapshot));
const skills = snapshot.classes.reduce((total, entry) => total + entry.skills.length, 0);
console.log(`wrote ${path.relative(process.cwd(), OUTPUT)} (${(bytes / 1024).toFixed(1)} KB)`);
console.log(`  game build ${snapshot.gameBuild || "unknown"} (${snapshot.gameLabel || "unlabelled"})`
  + ` from ${siteDir ? path.resolve(siteDir) : origin}`);
console.log(`  ${Object.keys(snapshot.equipment).length} equipment, ${snapshot.cards.length} cards, ${snapshot.gems.length} gems,`
  + ` ${snapshot.artifacts.length} artifact sets, ${snapshot.grimoires.length} grimoires`);
console.log(`  ${snapshot.classes.length} classes, ${skills} skills, ${Object.keys(snapshot.statTypes).length} stat types`);

function flag(name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function load<T>(name: string): Promise<T> {
  if (siteDir) return JSON.parse(await readFile(path.join(siteDir, name), "utf8")) as T;
  const response = await fetch(`${origin.replace(/\/+$/, "")}/${name}`);
  if (!response.ok) throw new Error(`${name} -> HTTP ${response.status}`);
  return await response.json() as T;
}
