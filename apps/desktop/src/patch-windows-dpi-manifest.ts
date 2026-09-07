import path from "node:path";
import { patchWindowsDpiManifest } from "../../../tooling/release/windows-dpi-manifest.ts";

const executable = path.join(import.meta.dir, "..", "dist", "spirit-vale-overlay", "spirit-vale-overlay-win_x64.exe");
await patchWindowsDpiManifest(executable);
console.log(`Enabled Per-Monitor DPI Awareness V2: ${executable}`);
