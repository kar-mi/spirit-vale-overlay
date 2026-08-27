import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

interface PackageJson {
  version?: string;
  packageManager?: string;
}

interface NeutralinoConfig {
  version?: string;
  applicationName?: string;
  author?: string;
  description?: string;
  copyright?: string;
  cli?: { binaryName?: string };
}

const projectRoot = path.resolve(import.meta.dir, "..", "..");
const appRoot = path.join(projectRoot, "apps", "desktop");
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as PackageJson;
const neutralinoConfig = JSON.parse(
  await readFile(path.join(appRoot, "neutralino.config.json"), "utf8"),
) as NeutralinoConfig;
const version = packageJson.version;
const bunVersion = packageJson.packageManager?.match(/^bun@(.+)$/)?.[1];
if (!version) throw new Error("package.json must define a version before verification.");
if (!bunVersion) throw new Error("package.json must pin Bun via packageManager before verification.");
if (neutralinoConfig.version !== version) {
  throw new Error(`neutralino.config.json version ${neutralinoConfig.version ?? "missing"} does not match ${version}.`);
}

const defaultZip = path.join(appRoot, "dist", "spirit-vale-overlay-release.zip");
const zipPath = path.resolve(projectRoot, Bun.argv[2] ?? defaultZip);
const checkRoot = path.join(projectRoot, "dist", "portable-check");

const requiredPaths = [
  ".spirit-vale-portable",
  "README.txt",
  "resources.neu",
  "extensions/backend/index.js",
  "extensions/backend/index.js.map",
  "extensions/bin/bun.exe",
  "extensions/bin/sv-overlay-hotkeys.exe",
  "spirit-vale-overlay-win_x64.exe",
] as const;

const forbiddenPaths = [
  ".tmp",
  ".neutralino-backend-owner.json",
  "neutralino-backend.log",
  "neutralinojs.log",
  "error.log",
  "data",
  "spirit-vale-overlay-linux_arm64",
  "spirit-vale-overlay-linux_armhf",
  "spirit-vale-overlay-linux_x64",
  "spirit-vale-overlay-mac_arm64",
  "spirit-vale-overlay-mac_universal",
  "spirit-vale-overlay-mac_x64",
  "bin/launcher.exe",
  "Resources/main.js",
  "Resources/build.json",
  "Resources/version.json",
  "Spirit Vale Overlay-Setup.exe",
  "Spirit Vale Overlay-Setup.metadata.json",
  "Spirit Vale Overlay-Setup.tar.zst",
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

function toWindowsFileVersion(semanticVersion: string): string {
  const parts = semanticVersion.split(/[.+-]/, 4).map((part) => Number.parseInt(part, 10));
  return [0, 1, 2, 3]
    .map((index) => Number.isFinite(parts[index]) ? Math.min(Math.max(parts[index]!, 0), 65535) : 0)
    .join(".");
}

if (!existsSync(zipPath)) throw new Error(`Missing Neutralino Windows release ZIP: ${zipPath}`);

await rm(checkRoot, { recursive: true, force: true });
await mkdir(checkRoot, { recursive: true });
run("powershell", [
  "-NoProfile",
  "-Command",
  `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${checkRoot.replaceAll("'", "''")}' -Force`,
]);

for (const relativePath of requiredPaths) {
  if (!existsSync(path.join(checkRoot, relativePath))) {
    throw new Error(`Neutralino Windows release ZIP is missing required path: ${relativePath}`);
  }
}
for (const relativePath of forbiddenPaths) {
  if (existsSync(path.join(checkRoot, relativePath))) {
    throw new Error(`Neutralino Windows release ZIP contains forbidden path: ${relativePath}`);
  }
}

const executablePath = path.join(checkRoot, "spirit-vale-overlay-win_x64.exe");
const metadata = readVersionInfo(executablePath);
const expectedEntries = {
  CompanyName: neutralinoConfig.author,
  FileDescription: neutralinoConfig.description,
  FileVersion: toWindowsFileVersion(version),
  LegalCopyright: neutralinoConfig.copyright,
  OriginalFilename: neutralinoConfig.cli?.binaryName,
  ProductName: neutralinoConfig.applicationName,
  ProductVersion: version,
};
for (const [key, expected] of Object.entries(expectedEntries)) {
  if (!expected) throw new Error(`neutralino.config.json must define metadata for ${key}.`);
  if (metadata[key] !== expected) {
    throw new Error(`Portable executable has ${key} "${metadata[key]}", expected "${expected}".`);
  }
}

const bunExecutable = path.join(checkRoot, "extensions", "bin", "bun.exe");
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

const readme = await readFile(path.join(checkRoot, "README.txt"), "utf8");
for (const expected of [
  "run \"spirit-vale-overlay-win_x64.exe\"",
  "data\\settings\\",
  "data\\logs\\",
  "data\\runtime\\",
  "out of Windows AppData",
  "Delete .spirit-vale-portable",
  "%APPDATA%\\Spirit Vale Overlay\\data\\",
  "does not move existing portable data",
  "Npcap",
  "Windows x64 only",
]) {
  if (!readme.includes(expected)) throw new Error(`Portable README is missing expected text: ${expected}`);
}

console.log(`Neutralino Windows release ZIP verified: ${zipPath}`);
