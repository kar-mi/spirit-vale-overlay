import path from "node:path";

const appRoot = path.resolve(import.meta.dir, "..");
const bundleRoot = path.join(appRoot, "dist", "spirit-vale-neutralino-poc");
const binary = process.platform === "win32"
  ? path.join(bundleRoot, "spirit-vale-neutralino-poc-win_x64.exe")
  : process.platform === "darwin"
    ? path.join(bundleRoot, process.arch === "arm64" ? "spirit-vale-neutralino-poc-mac_arm64" : "spirit-vale-neutralino-poc-mac_x64")
    : path.join(bundleRoot, process.arch === "arm64" ? "spirit-vale-neutralino-poc-linux_arm64" : "spirit-vale-neutralino-poc-linux_x64");

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
