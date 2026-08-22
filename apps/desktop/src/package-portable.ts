import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const appRoot = path.resolve(import.meta.dir, "..");
const release = path.join(appRoot, "dist", "spirit-vale-overlay");
const portable = path.join(appRoot, "dist", "portable", "SpiritValeOverlay");
await rm(portable, { recursive: true, force: true });
await mkdir(portable, { recursive: true });
await Promise.all([
  cp(path.join(release, "resources.neu"), path.join(portable, "resources.neu")),
  cp(path.join(release, "extensions"), path.join(portable, "extensions"), { recursive: true }),
  cp(path.join(release, "spirit-vale-overlay-win_x64.exe"), path.join(portable, "SpiritValeOverlay.exe")),
  writeFile(path.join(portable, ".spirit-vale-portable"), "Spirit Vale Overlay portable data marker.\n"),
]);
console.log(`Portable Spirit Vale Overlay: ${portable}`);
