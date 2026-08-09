import { createReadStream, existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import { productName } from "./windows-executable-metadata.ts";

interface PackageJson {
  version?: string;
}

const projectRoot = path.resolve(import.meta.dir, "..", "..");
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as PackageJson;
function requireVersion(value: string | undefined): string {
  if (!value) throw new Error("package.json must define a version before packaging.");
  return value;
}

const version = requireVersion(packageJson.version);

const folderName = `Spirit-Vale-Overlay-v${version}-win-x64`;
const artifactName = `Spirit-Vale-Overlay-portable-win-x64-v${version}`;
const stagingRoot = path.join(projectRoot, "dist", "portable-staging");
const portableRoot = path.join(stagingRoot, folderName);
// Electrobun names the bundle folder after the app name with its spaces stripped.
const extractedBundle = path.join(portableRoot, "SpiritValeOverlay");
const releasesDirectory = path.join(projectRoot, "dist", "releases");
const zipPath = path.join(releasesDirectory, `${artifactName}.zip`);
const temporaryZipPath = path.join(releasesDirectory, `${artifactName}.tmp.zip`);
const checksumPath = `${zipPath}.sha256`;

// Electrobun bundles these helpers unconditionally. The portable release uses loose
// resources (not ASAR) and is distributed through manual ZIP downloads, so neither
// ASAR access nor the differential auto-updater is part of this distribution.
const unusedElectrobunHelpers = [
  "bin/bspatch.exe",
  "bin/libasar.dll",
  "bin/libasar-arm64.dll",
  "bin/zig-zstd.exe",
  "Info.plist",
] as const;

function run(command: string, args: string[]): void {
  console.log(`> ${[command, ...args].join(" ")}`);
  const result = Bun.spawnSync([command, ...args], {
    cwd: projectRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.exitCode}`);
  }
}

function assertManagedPath(candidate: string): void {
  const relative = path.relative(projectRoot, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to manage a path outside the project: ${candidate}`);
  }
}

async function removeManaged(candidate: string): Promise<void> {
  assertManagedPath(candidate);
  await rm(candidate, { recursive: true, force: true });
}

function findStablePayload(): string {
  const candidates = [
    path.join(projectRoot, "apps", "launcher", "dist", "artifacts", "stable-win-x64-SpiritValeOverlay.tar.zst"),
    path.join(projectRoot, "apps", "launcher", "dist", "electrobun", "stable-win-x64", "Spirit Vale Overlay-Setup.tar.zst"),
  ];
  const payload = candidates.find((candidate) => existsSync(candidate));
  if (!payload) throw new Error("Electrobun did not produce the expected stable Windows payload.");
  return payload;
}

async function flattenExtractedBundle(): Promise<void> {
  if (!existsSync(extractedBundle)) {
    throw new Error(`The stable payload did not contain the expected SpiritValeOverlay folder.`);
  }
  for (const entry of await readdir(extractedBundle)) {
    await rename(path.join(extractedBundle, entry), path.join(portableRoot, entry));
  }
  await removeManaged(extractedBundle);
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function main(): Promise<void> {
  await removeManaged(stagingRoot);
  await removeManaged(temporaryZipPath);
  await mkdir(portableRoot, { recursive: true });
  await mkdir(releasesDirectory, { recursive: true });

  run("bun", ["run", "--filter", "@svoverlay/launcher", "build", "--", "--env=stable"]);
  run("tar", ["-xf", findStablePayload(), "-C", portableRoot]);
  await flattenExtractedBundle();

  for (const relativePath of unusedElectrobunHelpers) {
    await removeManaged(path.join(portableRoot, relativePath));
  }

  const nativeLauncher = path.join(portableRoot, "bin", "launcher.exe");
  const bunRuntime = path.join(portableRoot, "bin", "bun.exe");
  const applicationIcon = path.join(projectRoot, "apps", "launcher", "dist", "electrobun", "stable-win-x64", "app-icon.ico");
  if (!existsSync(nativeLauncher) || !existsSync(bunRuntime) || !existsSync(applicationIcon)) {
    throw new Error("The Electrobun build is missing its Windows runtime executables or application icon.");
  }

  const portableLauncherName = `${productName}.lnk`;
  run("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(projectRoot, "tooling", "release", "build-portable-shortcut.ps1"),
    "-OutputPath",
    path.join(portableRoot, portableLauncherName),
    "-TargetPath",
    nativeLauncher,
  ]);
  await writeFile(path.join(portableRoot, ".spirit-vale-portable"), "portable\r\n", "utf8");

  await writeFile(path.join(portableRoot, "README.txt"), [
    `${productName} Portable`,
    `Version ${version}`,
    "",
    `Extract the complete folder, then run "${portableLauncherName}".`,
    `Keep ${portableLauncherName} beside the bin and Resources folders.`,
    "",
    "Npcap is required and is not included. Install it separately with WinPcap API-compatible mode enabled.",
    "",
    "This build is self-contained. Settings and capture sessions are written beneath the data folder:",
    "- Settings: data\\settings\\",
    "- Capture and replay logs: data\\logs\\",
    "- Runtime, browser, and temporary data: data\\runtime\\",
    "",
    `The portable build keeps application data out of Windows AppData. Start the app with ${portableLauncherName}.`,
    "",
  ].join("\r\n"), "utf8");

  await removeManaged(zipPath);
  await removeManaged(checksumPath);
  run("powershell", [
    "-NoProfile",
    "-Command",
    `Compress-Archive -LiteralPath ${quotePowerShell(portableRoot)} -DestinationPath ${quotePowerShell(temporaryZipPath)} -Force`,
  ]);
  await cp(temporaryZipPath, zipPath);
  await removeManaged(temporaryZipPath);

  const checksum = await sha256(zipPath);
  await writeFile(checksumPath, `${checksum}  ${path.basename(zipPath)}\n`, "utf8");
  await removeManaged(stagingRoot);
  run("bun", ["run", "verify:portable", zipPath]);

  console.log(`Portable ZIP created: ${zipPath}`);
  console.log(`SHA-256 created: ${checksumPath}`);
}

await main();
