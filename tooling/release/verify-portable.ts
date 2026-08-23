import { createReadStream, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { companyName, productName, toWindowsVersion } from "./windows-executable-metadata.ts";

interface PackageJson {
  version?: string;
  packageManager?: string;
}

const projectRoot = path.resolve(import.meta.dir, "..", "..");
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as PackageJson;
const version = packageJson.version;
const bunVersion = packageJson.packageManager?.match(/^bun@(.+)$/)?.[1];
if (!version) throw new Error("package.json must define a version before verification.");
if (!bunVersion) throw new Error("package.json must pin Bun via packageManager before verification.");

const folderName = `Spirit-Vale-Overlay-v${version}-win-x64`;
const defaultZip = path.join(projectRoot, "dist", "releases", `Spirit-Vale-Overlay-portable-win-x64-v${version}.zip`);
const zipPath = path.resolve(projectRoot, Bun.argv[2] ?? defaultZip);
const checksumPath = `${zipPath}.sha256`;
const checkRoot = path.join(projectRoot, "dist", "portable-check");
const extractedRoot = path.join(checkRoot, folderName);

const requiredPaths = [
  ".spirit-vale-portable",
  "README.txt",
  "SpiritValeOverlay.exe",
  "resources.neu",
  "extensions/backend/index.js",
  "extensions/bin/bun.exe",
  "extensions/bin/sv-overlay-hotkeys.exe",
] as const;

const forbiddenPaths = [
  ".neutralino-backend-owner.json",
  "neutralino-backend.log",
  "neutralinojs.log",
  "error.log",
  "bin/launcher.exe",
  "Resources/main.js",
  "Resources/build.json",
  "Resources/version.json",
  `${productName}-Setup.exe`,
  `${productName}-Setup.metadata.json`,
  `${productName}-Setup.tar.zst`,
  "SpiritValeOverlay-Setup.zip",
  "Info.plist",
] as const;

function run(command: string, args: string[], stdout: "inherit" | "pipe" = "inherit") {
  const result = Bun.spawnSync([command, ...args], {
    cwd: projectRoot,
    stdout,
    stderr: "inherit",
  });
  if (result.exitCode !== 0) throw new Error(`${command} failed with exit code ${result.exitCode}`);
  return result;
}

function readVersionInfo(executablePath: string): Record<string, string | null> {
  const result = run("pwsh", [
    "-NoProfile",
    "-Command",
    `(Get-Item -LiteralPath '${executablePath.replaceAll("'", "''")}').VersionInfo | `
    + "Select-Object CompanyName, FileDescription, FileVersion, LegalCopyright, OriginalFilename, "
    + "ProductName, ProductVersion | ConvertTo-Json -Compress",
  ], "pipe");
  return JSON.parse(new TextDecoder().decode(result.stdout)) as Record<string, string | null>;
}

function readAuthenticodeSignature(executablePath: string): { Status: string; SignerSubject: string | null } {
  const result = run("pwsh", [
    "-NoProfile",
    "-Command",
    `$signature = Get-AuthenticodeSignature -LiteralPath '${executablePath.replaceAll("'", "''")}'; `
    + "[pscustomobject]@{ Status = $signature.Status.ToString(); SignerSubject = $signature.SignerCertificate.Subject } | ConvertTo-Json -Compress",
  ], "pipe");
  return JSON.parse(new TextDecoder().decode(result.stdout)) as { Status: string; SignerSubject: string | null };
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
    throw new Error(`Portable ZIP contains forbidden path: ${folderName}/${relativePath}`);
  }
}

const executablePath = path.join(extractedRoot, "SpiritValeOverlay.exe");
const metadata = readVersionInfo(executablePath);
const expectedEntries = {
  CompanyName: companyName,
  FileVersion: toWindowsVersion(version),
  OriginalFilename: "SpiritValeOverlay.exe",
  ProductName: productName,
  ProductVersion: toWindowsVersion(version),
};
for (const [key, expected] of Object.entries(expectedEntries)) {
  if (metadata[key] !== expected) {
    throw new Error(`Portable executable has ${key} "${metadata[key]}", expected "${expected}".`);
  }
}
for (const key of ["FileDescription", "LegalCopyright"]) {
  if (!metadata[key]?.trim()) throw new Error(`Portable executable is missing ${key}.`);
}

const bunExecutable = path.join(extractedRoot, "extensions", "bin", "bun.exe");
const bunSignature = readAuthenticodeSignature(bunExecutable);
if (bunSignature.Status !== "Valid") {
  throw new Error(`Portable Bun runtime has Authenticode status ${bunSignature.Status}, expected Valid.`);
}
if (!bunSignature.SignerSubject?.includes("Codeblog CORP")) {
  throw new Error(`Portable Bun runtime has unexpected signer: ${bunSignature.SignerSubject ?? "none"}.`);
}
const bundledBunVersion = new TextDecoder().decode(run(bunExecutable, ["--version"], "pipe").stdout).trim();
if (bundledBunVersion !== bunVersion) {
  throw new Error(`Portable Bun runtime is ${bundledBunVersion}, expected ${bunVersion}.`);
}

const readme = await readFile(path.join(extractedRoot, "README.txt"), "utf8");
for (const expected of [
  `Version ${version}`,
  "run \"SpiritValeOverlay.exe\"",
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
