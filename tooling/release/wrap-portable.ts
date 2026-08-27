import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extract, Zip } from "zip-lib";

interface PackageJson {
  version?: string;
}

const projectRoot = path.resolve(import.meta.dir, "..", "..");
const appDist = path.join(projectRoot, "apps", "desktop", "dist");

const f = await readFile(path.join(projectRoot, "package.json"), "utf8");

console.log(f);
let packageJson: PackageJson | undefined;

try {
  packageJson = JSON.parse(f) as PackageJson;
} catch (err) {
  throw new Error(`Error: ${err} ${f}`);
}


if (!packageJson.version) throw new Error("package.json must define a version before packaging.");

const bundleName = `spirit-vale-overlay-windows-x64-v${packageJson.version}`;
const neutralinoZip = path.join(appDist, "spirit-vale-overlay-release.zip");
const releaseZip = path.join(appDist, `${bundleName}.zip`);

if (!existsSync(neutralinoZip)) {
  throw new Error(`Missing Neutralino release ZIP: ${neutralinoZip}`);
}

const stagingRoot = await mkdtemp(path.join(tmpdir(), "spirit-vale-portable-"));
const bundleRoot = path.join(stagingRoot, bundleName);

try {
  await mkdir(bundleRoot, { recursive: true });
  await extract(neutralinoZip, bundleRoot);
  await rm(releaseZip, { force: true });
  const archive = new Zip({ compressionLevel: 9 });
  archive.addFolder(bundleRoot, bundleName);
  await archive.archive(releaseZip);
  await rm(neutralinoZip);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}

console.log(`Versioned portable release created: ${releaseZip}`);
