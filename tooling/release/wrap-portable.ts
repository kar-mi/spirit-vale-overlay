import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extract, Zip } from "zip-lib";
import { electronBundleLayout } from "../../packages/desktop-platform/bundle-layout.ts";
import { patchWindowsDpiManifest } from "./windows-dpi-manifest.ts";

interface PackageJson {
  version?: string;
}

const projectRoot = path.resolve(import.meta.dir, "..", "..");

async function version(): Promise<string> {
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as PackageJson;
  if (!packageJson.version) throw new Error("package.json must define a version before packaging.");
  return packageJson.version;
}

async function zipSingleFolder(bundleRoot: string, bundleName: string, releaseZip: string): Promise<void> {
  await mkdir(path.dirname(releaseZip), { recursive: true });
  await rm(releaseZip, { force: true });
  const archive = new Zip({ compressionLevel: 9 });
  archive.addFolder(bundleRoot, bundleName);
  await archive.archive(releaseZip);
  console.log(`Versioned portable release created: ${releaseZip}`);
}

/**
 * Neutralino: `neu build --release` emits a flat ZIP; re-wrap it inside the single
 * versioned top-level folder the verifier and download links expect.
 */
async function wrapNeutralino(stagingRoot: string): Promise<void> {
  const appDist = path.join(projectRoot, "apps", "desktop", "dist");
  const bundleName = `spirit-vale-overlay-windows-x64-v${await version()}`;
  const neutralinoZip = path.join(appDist, "spirit-vale-overlay-release.zip");
  if (!existsSync(neutralinoZip)) throw new Error(`Missing Neutralino release ZIP: ${neutralinoZip}`);

  const bundleRoot = path.join(stagingRoot, bundleName);
  await mkdir(bundleRoot, { recursive: true });
  await extract(neutralinoZip, bundleRoot);
  await patchWindowsDpiManifest(path.join(bundleRoot, "spirit-vale-overlay-win_x64.exe"));
  await zipSingleFolder(bundleRoot, bundleName, path.join(appDist, `${bundleName}.zip`));
  await rm(neutralinoZip);
}

/**
 * Electron: `electron-builder --win dir` emits `release/win-unpacked/`; zip it inside
 * the single versioned top-level folder, ensuring the portable marker + README are present.
 */
async function wrapElectron(stagingRoot: string): Promise<void> {
  const appRoot = path.join(projectRoot, "apps", "desktop-electron");
  const unpacked = path.join(appRoot, "release", "win-unpacked");
  const bundleName = `spirit-vale-overlay-electron-windows-x64-v${await version()}`;
  if (!existsSync(unpacked)) throw new Error(`Missing Electron unpacked build: ${unpacked}`);

  const bundleRoot = path.join(stagingRoot, bundleName);
  await cp(unpacked, bundleRoot, { recursive: true });

  // electron-builder's extraFiles places these next to the exe; copy them in as a
  // fallback so the ZIP is well-formed even if that config regresses.
  for (const name of [electronBundleLayout.portableMarker, electronBundleLayout.portableReadme]) {
    if (!existsSync(path.join(bundleRoot, name))) await cp(path.join(appRoot, name), path.join(bundleRoot, name));
  }

  await zipSingleFolder(bundleRoot, bundleName, path.join(appRoot, "dist", `${bundleName}.zip`));
}

const shellArg = Bun.argv.indexOf("--shell");
const shell = shellArg !== -1 ? Bun.argv[shellArg + 1] : "neutralino";

const stagingRoot = await mkdtemp(path.join(tmpdir(), "spirit-vale-portable-"));
try {
  if (shell === "neutralino") await wrapNeutralino(stagingRoot);
  else if (shell === "electron") await wrapElectron(stagingRoot);
  else throw new Error(`Unknown --shell "${shell}"; expected "neutralino" or "electron".`);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}
