import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { productName, setWindowsExecutableMetadata } from "../../../tooling/release/windows-executable-metadata.ts";

const appRoot = path.resolve(import.meta.dir, "..");
const projectRoot = path.resolve(appRoot, "../..");
const release = path.join(appRoot, "dist", "spirit-vale-overlay");
const stagingRoot = path.join(appRoot, "dist", "portable");
const releasesRoot = path.join(projectRoot, "dist", "releases");
const { version } = JSON.parse(await readFile(path.join(appRoot, "neutralino.config.json"), "utf8")) as { version: string };
const folderName = `Spirit-Vale-Overlay-v${version}-win-x64`;
const portable = path.join(stagingRoot, folderName);
const portableExe = path.join(portable, "SpiritValeOverlay.exe");
const zipPath = path.join(releasesRoot, `Spirit-Vale-Overlay-portable-win-x64-v${version}.zip`);
const checksumPath = `${zipPath}.sha256`;

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(portable, { recursive: true });
await Promise.all([
  cp(path.join(release, "resources.neu"), path.join(portable, "resources.neu")),
  cp(path.join(release, "extensions"), path.join(portable, "extensions"), { recursive: true }),
  cp(path.join(release, "spirit-vale-overlay-win_x64.exe"), portableExe),
  writeFile(path.join(portable, ".spirit-vale-portable"), "Spirit Vale Overlay portable data marker.\n"),
  ...["settings", "logs", "runtime"].map((name) => mkdir(path.join(portable, "data", name), { recursive: true })),
]);

await setWindowsExecutableMetadata(portableExe, { fileDescription: productName, version });

await writeFile(path.join(portable, "README.txt"), [
  `${productName} - Version ${version}`,
  "",
  "Extract the complete ZIP, then run \"SpiritValeOverlay.exe\".",
  "Npcap is required. Install it in WinPcap API-compatible mode without restricting it to administrators.",
  "",
  "Portable data stays in this folder:",
  "- Settings: data\\settings\\",
  "- Logs: data\\logs\\",
  "- Runtime, browser, and temporary data: data\\runtime\\",
  "",
  "The portable marker keeps these files out of Windows AppData.",
  "",
].join("\n"));

await mkdir(releasesRoot, { recursive: true });
await rm(zipPath, { force: true });
run("powershell", [
  "-NoProfile",
  "-Command",
  `Compress-Archive -LiteralPath '${portable.replaceAll("'", "''")}' -DestinationPath '${zipPath.replaceAll("'", "''")}' -CompressionLevel Optimal -Force`,
]);
const checksum = await sha256(zipPath);
await writeFile(checksumPath, `${checksum}  ${path.basename(zipPath)}\n`);
await rm(stagingRoot, { recursive: true, force: true });

console.log(`Portable Spirit Vale Overlay: ${zipPath}`);

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
