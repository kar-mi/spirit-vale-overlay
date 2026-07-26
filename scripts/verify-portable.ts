import { createReadStream, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

interface PackageJson {
  version?: string;
}

const projectRoot = path.resolve(import.meta.dir, "..");
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as PackageJson;
const version = packageJson.version;
if (!version) throw new Error("package.json must define a version before verification.");

const folderName = `Spirit-Vale-v${version}-win-x64`;
const defaultZip = path.join(projectRoot, "dist", "releases", `Spirit-Vale-portable-win-x64-v${version}.zip`);
const zipPath = path.resolve(projectRoot, Bun.argv[2] ?? defaultZip);
const checksumPath = `${zipPath}.sha256`;
const checkRoot = path.join(projectRoot, "dist", "portable-check");
const extractedRoot = path.join(checkRoot, folderName);

const requiredPaths = [
  "Spirit Vale.exe",
  "README.txt",
  "bin/launcher.exe",
  "bin/bun.exe",
  "Resources/main.js",
  "Resources/build.json",
  "Resources/version.json",
] as const;

const forbiddenPaths = [
  "Spirit Vale-Setup.exe",
  "Spirit Vale-Setup.metadata.json",
  "Spirit Vale-Setup.tar.zst",
  "SpiritVale-Setup.zip",
] as const;

function run(command: string, args: string[]): void {
  const result = Bun.spawnSync([command, ...args], {
    cwd: projectRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) throw new Error(`${command} failed with exit code ${result.exitCode}`);
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

if (!existsSync(zipPath)) throw new Error(`Missing portable ZIP: ${zipPath}`);
if (!existsSync(checksumPath)) throw new Error(`Missing SHA-256 file: ${checksumPath}`);

await rm(checkRoot, { recursive: true, force: true });
await mkdir(checkRoot, { recursive: true });
run("powershell", [
  "-NoProfile",
  "-Command",
  `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${checkRoot.replaceAll("'", "''")}' -Force`,
]);

for (const relativePath of requiredPaths) {
  if (!existsSync(path.join(extractedRoot, relativePath))) {
    throw new Error(`Portable ZIP is missing required path: ${folderName}/${relativePath}`);
  }
}
for (const relativePath of forbiddenPaths) {
  if (existsSync(path.join(extractedRoot, relativePath))) {
    throw new Error(`Portable ZIP contains installer-only path: ${folderName}/${relativePath}`);
  }
}

const readme = await readFile(path.join(extractedRoot, "README.txt"), "utf8");
for (const expected of [
  `Version ${version}`,
  'run "Spirit Vale.exe"',
  "data\\settings\\",
  "data\\logs\\",
  "data\\runtime\\",
  "out of Windows AppData",
  "Npcap",
]) {
  if (!readme.includes(expected)) throw new Error(`Portable README is missing expected text: ${expected}`);
}

const checksumText = (await readFile(checksumPath, "utf8")).trim();
const expectedChecksum = checksumText.split(/\s+/)[0];
const actualChecksum = await sha256(zipPath);
if (!expectedChecksum || expectedChecksum.toLowerCase() !== actualChecksum) {
  throw new Error("Portable ZIP SHA-256 does not match its checksum file.");
}

console.log(`Portable ZIP verified: ${zipPath}`);
