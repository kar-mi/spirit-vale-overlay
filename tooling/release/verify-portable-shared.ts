import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

export function run(
  command: string,
  args: string[],
  cwd: string,
  stdout: "inherit" | "pipe" = "inherit",
): Bun.SyncSubprocess {
  const result = Bun.spawnSync([command, ...args], { cwd, stdout, stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`${command} failed with exit code ${result.exitCode}`);
  return result;
}

export function readVersionInfo(executablePath: string, cwd: string): Record<string, string | null> {
  const result = run("pwsh", [
    "-NoProfile",
    "-Command",
    `(Get-Item -LiteralPath '${executablePath.replaceAll("'", "''")}').VersionInfo | `
    + "Select-Object CompanyName, FileDescription, FileVersion, LegalCopyright, OriginalFilename, "
    + "ProductName, ProductVersion | ConvertTo-Json -Compress",
  ], cwd, "pipe");
  return JSON.parse(new TextDecoder().decode(result.stdout)) as Record<string, string | null>;
}

export function readAuthenticodeSignature(
  executablePath: string,
  cwd: string,
): { Status: string; SignerSubject: string | null } {
  const result = run("pwsh", [
    "-NoProfile",
    "-Command",
    `$signature = Get-AuthenticodeSignature -LiteralPath '${executablePath.replaceAll("'", "''")}'; `
    + "[pscustomobject]@{ Status = $signature.Status.ToString(); SignerSubject = $signature.SignerCertificate.Subject } | ConvertTo-Json -Compress",
  ], cwd, "pipe");
  return JSON.parse(new TextDecoder().decode(result.stdout)) as { Status: string; SignerSubject: string | null };
}

export function toWindowsFileVersion(semanticVersion: string): string {
  const parts = semanticVersion.split(/[.+-]/, 4).map((part) => Number.parseInt(part, 10));
  return [0, 1, 2, 3]
    .map((index) => Number.isFinite(parts[index]) ? Math.min(Math.max(parts[index]!, 0), 65535) : 0)
    .join(".");
}

/** Expands the ZIP and asserts it holds exactly the single top-level folder `bundleName`. */
export async function expandBundle(
  zipPath: string,
  checkRoot: string,
  bundleName: string,
  cwd: string,
): Promise<string> {
  if (!existsSync(zipPath)) throw new Error(`Missing Windows release ZIP: ${zipPath}`);
  await rm(checkRoot, { recursive: true, force: true });
  await mkdir(checkRoot, { recursive: true });
  run("powershell", [
    "-NoProfile",
    "-Command",
    `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${checkRoot.replaceAll("'", "''")}' -Force`,
  ], cwd);

  const topLevelEntries = await readdir(checkRoot);
  if (topLevelEntries.length !== 1 || topLevelEntries[0] !== bundleName) {
    throw new Error(
      `Portable ZIP must contain only the top-level folder ${bundleName}; found: ${topLevelEntries.join(", ") || "nothing"}.`,
    );
  }
  return path.join(checkRoot, bundleName);
}

export function assertPaths(
  bundleRoot: string,
  { required, forbidden }: { required: readonly string[]; forbidden: readonly string[] },
): void {
  for (const relativePath of required) {
    if (!existsSync(path.join(bundleRoot, relativePath))) {
      throw new Error(`Windows release ZIP is missing required path: ${relativePath}`);
    }
  }
  for (const relativePath of forbidden) {
    if (existsSync(path.join(bundleRoot, relativePath))) {
      throw new Error(`Windows release ZIP contains forbidden path: ${relativePath}`);
    }
  }
}

export function assertBundledBun(
  bunExecutable: string,
  expectedBunVersion: string,
  cwd: string,
): void {
  const signature = readAuthenticodeSignature(bunExecutable, cwd);
  if (signature.Status !== "Valid") {
    throw new Error(`Portable Bun runtime has Authenticode status ${signature.Status}, expected Valid.`);
  }
  if (!signature.SignerSubject?.includes("Codeblog CORP")) {
    throw new Error(`Portable Bun runtime has unexpected signer: ${signature.SignerSubject ?? "none"}.`);
  }
  const bundledBunVersion = new TextDecoder().decode(run(bunExecutable, ["--version"], cwd, "pipe").stdout).trim();
  if (bundledBunVersion !== expectedBunVersion) {
    throw new Error(`Portable Bun runtime is ${bundledBunVersion}, expected ${expectedBunVersion}.`);
  }
}

export async function assertReadmeText(readmePath: string, expected: readonly string[]): Promise<void> {
  const readme = await readFile(readmePath, "utf8");
  for (const text of expected) {
    if (!readme.includes(text)) throw new Error(`Portable README is missing expected text: ${text}`);
  }
}

/** Portable-data instructions every shell's README must carry (exe name checked separately). */
export const sharedReadmeText = [
  "data\\settings\\",
  "data\\logs\\",
  "data\\runtime\\",
  "out of Windows AppData",
  "Delete .spirit-vale-portable",
  "%APPDATA%\\Spirit Vale Overlay\\data\\",
  "does not move existing portable data",
  "Npcap",
  "Windows x64 only",
] as const;
