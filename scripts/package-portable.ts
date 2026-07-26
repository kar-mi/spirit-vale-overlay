import { createReadStream, existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

interface PackageJson {
  version?: string;
}

const projectRoot = path.resolve(import.meta.dir, "..");
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as PackageJson;
const version = packageJson.version;
if (!version) throw new Error("package.json must define a version before packaging.");

const folderName = `Spirit-Vale-v${version}-win-x64`;
const artifactName = `Spirit-Vale-portable-win-x64-v${version}`;
const stagingRoot = path.join(projectRoot, "dist", "portable-staging");
const portableRoot = path.join(stagingRoot, folderName);
const extractedBundle = path.join(portableRoot, "SpiritVale");
const releasesDirectory = path.join(projectRoot, "dist", "releases");
const zipPath = path.join(releasesDirectory, `${artifactName}.zip`);
const temporaryZipPath = path.join(releasesDirectory, `${artifactName}.tmp.zip`);
const checksumPath = `${zipPath}.sha256`;

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
    path.join(projectRoot, "packages", "ui", "dist", "artifacts", "stable-win-x64-SpiritVale.tar.zst"),
    path.join(projectRoot, "packages", "ui", "dist", "electrobun", "stable-win-x64", "Spirit Vale-Setup.tar.zst"),
  ];
  const payload = candidates.find((candidate) => existsSync(candidate));
  if (!payload) throw new Error("Electrobun did not produce the expected stable Windows payload.");
  return payload;
}

async function flattenExtractedBundle(): Promise<void> {
  if (!existsSync(extractedBundle)) {
    throw new Error(`The stable payload did not contain the expected SpiritVale folder.`);
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

  run("bun", ["run", "--filter", "@spiritvale/ui", "build", "--", "--env=stable"]);
  run("tar", ["-xf", findStablePayload(), "-C", portableRoot]);
  await flattenExtractedBundle();

  const nativeLauncher = path.join(portableRoot, "bin", "launcher.exe");
  const bunRuntime = path.join(portableRoot, "bin", "bun.exe");
  const applicationIcon = path.join(projectRoot, "packages", "ui", "dist", "electrobun", "stable-win-x64", "app-icon.ico");
  if (!existsSync(nativeLauncher) || !existsSync(bunRuntime) || !existsSync(applicationIcon)) {
    throw new Error("The Electrobun build is missing its Windows runtime executables or application icon.");
  }

  run("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(projectRoot, "scripts", "build-portable-launcher.ps1"),
    "-OutputPath",
    path.join(portableRoot, "Spirit Vale.exe"),
    "-IconPath",
    applicationIcon,
  ]);

  await writeFile(path.join(portableRoot, "README.txt"), [
    "Spirit Vale Portable",
    `Version ${version}`,
    "",
    'Extract the complete folder, then run "Spirit Vale.exe".',
    "Keep Spirit Vale.exe beside the bin and Resources folders.",
    "",
    "Npcap is required and is not included. Install it separately with WinPcap API-compatible mode enabled.",
    "",
    "This build is self-contained. Settings and capture sessions are written beneath the data folder:",
    "- Settings: data\\settings\\",
    "- Capture and replay logs: data\\logs\\",
    "- Runtime, browser, and temporary data: data\\runtime\\",
    "",
    "The portable launcher keeps application data out of Windows AppData. Always start the app with Spirit Vale.exe.",
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
  run("bun", ["run", "verify:portable", zipPath]);

  console.log(`Portable ZIP created: ${zipPath}`);
  console.log(`SHA-256 created: ${checksumPath}`);
}

await main();
