import path from "node:path";

// Launch the staged Electron app (produced by `bun run prepare`) against the local
// dist/ tree. Packaging is a separate `bun run package` step.

const appRoot = path.resolve(import.meta.dir, "..");
const staged = path.join(appRoot, "dist");
const electronBin = path.join(appRoot, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");

const child = Bun.spawn([electronBin, staged], {
  cwd: staged,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}

process.exit(await child.exited);
