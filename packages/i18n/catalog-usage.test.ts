import { expect, test } from "bun:test";
import { Glob } from "bun";
import path from "node:path";

import { en } from "./locales/en.ts";

const repoRoot = path.resolve(import.meta.dir, "../..");

/**
 * Keys built by interpolating an enum into a template literal. `tsc` already proves each member
 * resolves to a real key, so a literal occurrence is not expected here.
 */
const DYNAMIC_PREFIXES = [
  "overlay.element.",
  "keybind.",
  "capture.warning.",
  "character.tab.",
];

async function sourceText(): Promise<string> {
  const glob = new Glob("{apps,packages}/**/*.{ts,tsx}");
  const chunks: string[] = [];
  for await (const file of glob.scan({ cwd: repoRoot })) {
    if (file.includes("node_modules")) continue;
    if (file.startsWith(path.join("packages", "i18n"))) continue;
    if (file.replaceAll("\\", "/").startsWith("packages/i18n/")) continue;
    chunks.push(await Bun.file(path.join(repoRoot, file)).text());
  }
  return chunks.join("\n");
}

const sources = await sourceText();

test("every catalog key is referenced by the app", () => {
  const unused = Object.keys(en).filter((key) => {
    if (DYNAMIC_PREFIXES.some((prefix) => key.startsWith(prefix))) return false;
    // Plural variants are addressed by their stem, never by the full `.one`/`.other` key.
    const stem = key.replace(/\.(one|two|few|many|other|zero)$/u, "");
    return !sources.includes(`"${key}"`) && !sources.includes(`"${stem}"`);
  });
  expect(unused).toEqual([]);
});
