import path from "node:path";

console.log("Hello from ./dev.ts", import.meta.dir);
const appRoot = path.resolve(import.meta.dir, "..");
const bundleRoot = path.join(appRoot, "dist", "spirit-vale-overlay");

console.log("Building for platform:", process.platform); // assume we're building for the host platform, and not a targeted platform.

const binary = process.platform === "win32"
  ? path.join(bundleRoot, "spirit-vale-overlay-win_x64.exe")
  : process.platform === "darwin"
    ? path.join(bundleRoot, process.arch === "arm64" ? "spirit-vale-overlay-mac_arm64" : "spirit-vale-overlay-mac_x64")
    : path.join(bundleRoot, process.arch === "arm64" ? "spirit-vale-overlay-linux_arm64" : "spirit-vale-overlay-linux_x64");

console.log("cwd:", bundleRoot);
console.log("binary:", binary);
console.log("Spawning child process...");

let child: Bun.Subprocess<"inherit", "inherit", "inherit"> | undefined;
try {
  child = Bun.spawn([
    binary,
  ], {
    cwd: bundleRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
} catch (err) {
  // we should perhaps assert the binaries exist in the build step prior, and throw an error, and perhaps call `bunx neu build` from the build step also just in case.
  // `bunx neu build`, should have copied the templated `spirit-vale-overlay/apps/desktop/bin/spirit-vale-overlay-{platform}.exe` to the bundleRoot path
  throw new Error(`An error occured while trying to spawn ${binary} process, it's quite likely that the executable template file is missing in prior build step & silently failed to copy so it could be missing, see cause for REAL EXACT details: `, { cause: err });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  console.log("Got SIG, Killing child process:", signal);
  switch (process.platform) {
    case "win32": process.on(signal, () => child.kill(signal)); break;
    default: console.warn("[WARN] WORKAROUND - Not killing child process.");
  }
}

console.log("Started child process:");
const exitCode = await child.exited;

console.log("Child process exited with exitcode, so we exit also:", exitCode);
process.exit(exitCode);
