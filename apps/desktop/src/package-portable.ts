import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NtExecutable, NtExecutableResource } from "pe-library";
import { Resource } from "resedit";

const appRoot = path.resolve(import.meta.dir, "..");
const release = path.join(appRoot, "dist", "spirit-vale-overlay");
const portable = path.join(appRoot, "dist", "portable", "SpiritValeOverlay");
const portableExe = path.join(portable, "SpiritValeOverlay.exe");
const { version } = JSON.parse(await readFile(path.join(appRoot, "neutralino.config.json"), "utf8")) as { version: string };

await rm(portable, { recursive: true, force: true });
await mkdir(portable, { recursive: true });
await Promise.all([
  cp(path.join(release, "resources.neu"), path.join(portable, "resources.neu")),
  cp(path.join(release, "extensions"), path.join(portable, "extensions"), { recursive: true }),
  cp(path.join(release, "spirit-vale-overlay-win_x64.exe"), portableExe),
  writeFile(path.join(portable, ".spirit-vale-portable"), "Spirit Vale Overlay portable data marker.\n"),
]);

{
  const [major, minor, micro] = version.split(".").map((part) => Number(part));
  const exe = NtExecutable.from(await readFile(portableExe));
  const res = NtExecutableResource.from(exe);
  const [versionInfo] = Resource.VersionInfo.fromEntries(res.entries);
  if (!versionInfo) throw new Error("No version-info resource found in the built executable.");

  versionInfo.setFileVersion(major ?? 0, minor ?? 0, micro ?? 0);
  versionInfo.setProductVersion(major ?? 0, minor ?? 0, micro ?? 0);
  for (const language of versionInfo.getAllLanguagesForStringValues()) {
    versionInfo.setStringValues(language, {
      FileDescription: "Spirit Vale Overlay",
      ProductName: "Spirit Vale Overlay",
      OriginalFilename: "SpiritValeOverlay.exe",
    });
  }
  versionInfo.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  await writeFile(portableExe, Buffer.from(exe.generate()));
}

console.log(`Portable Spirit Vale Overlay: ${portable}`);
