import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const appRoot = path.resolve(import.meta.dir, "..");
const release = path.join(appRoot, "dist", "spirit-vale-neutralino-poc");
const portable = path.join(appRoot, "dist", "portable", "SpiritValeOverlay-Neutralino-POC");
await rm(portable, { recursive: true, force: true });
await mkdir(portable, { recursive: true });
await Promise.all([
  cp(path.join(release, "resources.neu"), path.join(portable, "resources.neu")),
  cp(path.join(release, "extensions"), path.join(portable, "extensions"), { recursive: true }),
  cp(path.join(release, "spirit-vale-neutralino-poc-win_x64.exe"), path.join(portable, "SpiritValeOverlay-Neutralino-POC.exe")),
  writeFile(path.join(portable, ".spirit-vale-portable"), "Neutralino POC portable data marker.\n"),
]);
console.log(`Portable Neutralino POC: ${portable}`);
