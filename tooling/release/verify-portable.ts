import { createReadStream, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { companyName, productName, toWindowsVersion } from "./windows-executable-metadata.ts";

interface PackageJson {
  version?: string;
}

const projectRoot = path.resolve(import.meta.dir, "..", "..");
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as PackageJson;
const version = packageJson.version;
if (!version) throw new Error("package.json must define a version before verification.");

const folderName = `Spirit-Vale-Overlay-v${version}-win-x64`;
const defaultZip = path.join(projectRoot, "dist", "releases", `Spirit-Vale-Overlay-portable-win-x64-v${version}.zip`);
const zipPath = path.resolve(projectRoot, Bun.argv[2] ?? defaultZip);
const checksumPath = `${zipPath}.sha256`;
const checkRoot = path.join(projectRoot, "dist", "portable-check");
const extractedRoot = path.join(checkRoot, folderName);

const requiredPaths = [
  `${productName}.lnk`,
  ".spirit-vale-portable",
  "README.txt",
  "bin/launcher.exe",
  "bin/bun.exe",
  "bin/sv-overlay-hotkeys.exe",
  "Resources/main.js",
  "Resources/build.json",
  "Resources/version.json",
] as const;

const forbiddenPaths = [
  `${productName}.exe`,
  "Spirit Vale.exe",
  `${productName}-Setup.exe`,
  `${productName}-Setup.metadata.json`,
  `${productName}-Setup.tar.zst`,
  "SpiritValeOverlay-Setup.zip",
] as const;

/** Executables that must carry the version metadata antivirus heuristics look for. */
const metadataPaths = ["bin/launcher.exe"] as const;

function run(command: string, args: string[]): void {
  const result = Bun.spawnSync([command, ...args], {
    cwd: projectRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) throw new Error(`${command} failed with exit code ${result.exitCode}`);
}

/**
 * Reads the version block the way Explorer does rather than by parsing the PE resources again:
 * a block can round-trip through a resource library and still show blank in Windows, which is
 * exactly the property sheet users and antivirus heuristics look at.
 */
function readVersionInfo(executablePath: string): Record<string, string | null> {
  const result = Bun.spawnSync([
    "powershell",
    "-NoProfile",
    "-Command",
    `(Get-Item -LiteralPath '${executablePath.replaceAll("'", "''")}').VersionInfo | `
    + "Select-Object CompanyName, FileDescription, FileVersion, LegalCopyright, OriginalFilename, "
    + "ProductName, ProductVersion | ConvertTo-Json -Compress",
  ], { stdout: "pipe", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`Could not read version metadata for ${executablePath}`);
  return JSON.parse(new TextDecoder().decode(result.stdout)) as Record<string, string | null>;
}

function readAuthenticodeSignature(executablePath: string): { Status: string; SignerSubject: string | null } {
  const result = Bun.spawnSync([
    "pwsh",
    "-NoProfile",
    "-Command",
    `$signature = Get-AuthenticodeSignature -LiteralPath '${executablePath.replaceAll("'", "''")}'; `
    + "[pscustomobject]@{ Status = $signature.Status.ToString(); SignerSubject = $signature.SignerCertificate.Subject } | ConvertTo-Json -Compress",
  ], { stdout: "pipe", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`Could not verify Authenticode signature for ${executablePath}`);
  return JSON.parse(new TextDecoder().decode(result.stdout)) as { Status: string; SignerSubject: string | null };
}

function resolveShortcutTarget(shortcutPath: string): string {
  const directory = path.dirname(shortcutPath).replaceAll("'", "''");
  const name = path.basename(shortcutPath).replaceAll("'", "''");
  const result = Bun.spawnSync([
    "pwsh",
    "-NoProfile",
    "-Command",
    `$shell = New-Object -ComObject Shell.Application; $folder = $shell.NameSpace('${directory}'); `
    + `$item = $folder.ParseName('${name}'); if ($null -eq $item) { throw 'Shortcut was not found.' }; `
    + "$link = $item.GetLink; $link.Resolve(1); $link.Path",
  ], { stdout: "pipe", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`Could not resolve portable shortcut: ${shortcutPath}`);
  return new TextDecoder().decode(result.stdout).trim();
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

for (const relativePath of metadataPaths) {
  const metadata = readVersionInfo(path.join(extractedRoot, relativePath));
  const expectedEntries = {
    CompanyName: companyName,
    FileVersion: toWindowsVersion(version),
    OriginalFilename: path.basename(relativePath),
    ProductName: productName,
    ProductVersion: toWindowsVersion(version),
  };
  for (const [key, expected] of Object.entries(expectedEntries)) {
    if (metadata[key] !== expected) {
      throw new Error(`Portable executable ${relativePath} has ${key} "${metadata[key]}", expected "${expected}".`);
    }
  }
  for (const key of ["FileDescription", "LegalCopyright"]) {
    if (!metadata[key]?.trim()) throw new Error(`Portable executable ${relativePath} is missing ${key}.`);
  }
}

const bunExecutable = path.join(extractedRoot, "bin", "bun.exe");
const bunSignature = readAuthenticodeSignature(bunExecutable);
if (bunSignature.Status !== "Valid") {
  throw new Error(`Portable Bun runtime has Authenticode status ${bunSignature.Status}, expected Valid.`);
}
if (!bunSignature.SignerSubject?.includes("Codeblog CORP")) {
  throw new Error(`Portable Bun runtime has unexpected signer: ${bunSignature.SignerSubject ?? "none"}.`);
}

const shortcutPath = path.join(extractedRoot, `${productName}.lnk`);
const shortcutTarget = resolveShortcutTarget(shortcutPath);
const expectedShortcutTarget = path.join(extractedRoot, "bin", "launcher.exe");
if (path.resolve(shortcutTarget).toLowerCase() !== path.resolve(expectedShortcutTarget).toLowerCase()) {
  throw new Error(`Portable shortcut resolves to ${shortcutTarget}, expected ${expectedShortcutTarget}.`);
}

const readme = await readFile(path.join(extractedRoot, "README.txt"), "utf8");
for (const expected of [
  `Version ${version}`,
  `run "${productName}.lnk"`,
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
