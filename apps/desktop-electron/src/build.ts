import { mkdir, rm, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BunPlugin } from "bun";
import { bundle, buildViews, copyViewAssets } from "@svoverlay/desktop/src/build-shared.ts";
import {
  electronBundleLayout,
  electronBundledHotkeyHelperPath,
  electronBundledRuntimePath,
} from "@svoverlay/desktop-platform/bundle-layout";


const appRoot = path.resolve(import.meta.dir, "..");
const workspace = path.resolve(appRoot, "../..");
const outRoot = path.join(appRoot, "dist");
const resources = path.join(outRoot, electronBundleLayout.resourcesDirectory);
const views = path.join(outRoot, electronBundleLayout.viewsDirectory);
const backendDir = path.join(outRoot, electronBundleLayout.backendDirectory);
const binDir = path.join(outRoot, electronBundleLayout.binaryDirectory);
const mainDir = path.join(outRoot, "main");

const electronViewPlugin: BunPlugin = {
  name: "electron-view",
  setup(build) {
    const electronView = path.join(appRoot, "src/frontend/view.ts");
    build.onResolve({ filter: /^@svoverlay\/desktop-runtime\/view$/ }, () => ({ path: electronView }));
  },
};

await rm(outRoot, { recursive: true, force: true });
await Promise.all([
  mkdir(views, { recursive: true }),
  mkdir(backendDir, { recursive: true }),
  mkdir(binDir, { recursive: true }),
  mkdir(mainDir, { recursive: true }),
]);

await bundle({ entrypoint: path.join(appRoot, "src/backend/index.ts"), outdir: backendDir, target: "bun" });
await buildViews({ workspace, viewsDir: views, plugins: [electronViewPlugin] });
await copyViewAssets({ workspace, viewsDir: views, resourcesDir: resources });

for (const entry of [
  { entrypoints: [path.join(appRoot, "src/main/index.ts")], outdir: mainDir, naming: "index.js" },
  { entrypoints: [path.join(appRoot, "src/main/preload.ts")], outdir: mainDir, naming: "preload.cjs", format: "cjs" as const },
]) {
  const result = await Bun.build({ target: "node", sourcemap: "external", external: ["electron"], ...entry });
  if (!result.success) throw new AggregateError(result.logs, `Build failed: ${entry.entrypoints[0]}`);
}

await writeFile(path.join(outRoot, "package.json"), `${JSON.stringify({
  name: "spirit-vale-overlay",
  productName: "Spirit Vale Overlay",
  version: (await Bun.file(path.join(workspace, "package.json")).json() as { version: string }).version,
  main: "main/index.js",
  type: "module",
}, null, 2)}\n`);

await copyFile(process.execPath, path.join(outRoot, electronBundledRuntimePath()));
if (process.platform === "win32") {
  const helper = Bun.spawn([
    "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", path.join(workspace, "tooling/release/build-pass-through-shortcuts.ps1"),
    "-OutputPath", path.join(outRoot, electronBundledHotkeyHelperPath()),
  ], { stdout: "inherit", stderr: "inherit" });
  if (await helper.exited !== 0) throw new Error("Could not build the pass-through hotkey helper.");
}

console.log(`Electron desktop app staged in ${outRoot}`);
