import path from "node:path";
import { getCurrentExecutableNames } from "@svoverlay/desktop-platform/executable-names";

const appRoot = path.resolve(import.meta.dir, "..");
const bundleRoot = path.join(appRoot, "dist", "spirit-vale-overlay");
const binary = path.join(bundleRoot, getCurrentExecutableNames().desktopApp);

const child = Bun.spawn([
  binary,
], {
  cwd: bundleRoot,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}

const exitCode = await child.exited;
process.exit(exitCode);
