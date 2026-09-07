import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { copyFile } from "node:fs/promises";
import {
  bundleLayout,
  bundledHotkeyHelperPath,
  bundledRuntimePath,
} from "@svoverlay/desktop-platform/bundle-layout";
import { bundle, buildViews, copyViewAssets } from "./build-shared.ts";

const appRoot = path.resolve(import.meta.dir, "..");
const workspace = path.resolve(appRoot, "../..");
const resources = path.join(appRoot, bundleLayout.resourcesDirectory);
const views = path.join(appRoot, bundleLayout.viewsDirectory);
const extensions = path.join(appRoot, bundleLayout.extensionsDirectory);
const backend = path.join(appRoot, bundleLayout.backendDirectory);
const bin = path.join(appRoot, bundleLayout.binaryDirectory);

await Promise.all([rm(resources, { recursive: true, force: true }), rm(extensions, { recursive: true, force: true })]);
await Promise.all([mkdir(views, { recursive: true }), mkdir(backend, { recursive: true }), mkdir(bin, { recursive: true })]);

await bundle({
  entrypoint: path.join(appRoot, "src/backend/index.ts"),
  outdir: backend,
  target: "bun",
});
await buildViews({ workspace, viewsDir: views });
await copyViewAssets({ workspace, viewsDir: views, resourcesDir: resources });

await copyFile(process.execPath, path.join(appRoot, bundledRuntimePath()));
if (process.platform === "win32") {
  const helper = Bun.spawn([
    "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", path.join(workspace, "tooling/release/build-pass-through-shortcuts.ps1"),
    "-OutputPath", path.join(appRoot, bundledHotkeyHelperPath()),
  ], { stdout: "inherit", stderr: "inherit" });
  if (await helper.exited !== 0) throw new Error("Could not build the pass-through hotkey helper.");
}
console.log(`Neutralino desktop app prepared in ${appRoot}`);
