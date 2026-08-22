
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
