import { cp, mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import {
  bundleLayout,
  bundledHotkeyHelperPath,
  bundledRuntimePath,
} from "@svoverlay/desktop-platform/bundle-layout";

const appRoot = path.resolve(import.meta.dir, "..");
const workspace = path.resolve(appRoot, "../..");
const resources = path.join(appRoot, bundleLayout.resourcesDirectory);
const views = path.join(appRoot, bundleLayout.viewsDirectory);
const extensions = path.join(appRoot, bundleLayout.extensionsDirectory);
const backend = path.join(appRoot, bundleLayout.backendDirectory);
const bin = path.join(appRoot, bundleLayout.binaryDirectory);

await Promise.all([rm(resources, { recursive: true, force: true }), rm(extensions, { recursive: true, force: true })]);
await Promise.all([mkdir(views, { recursive: true }), mkdir(backend, { recursive: true }), mkdir(bin, { recursive: true })]);

await build({
  entrypoint: path.join(appRoot, "src/backend/index.ts"),
  outdir: backend,
  target: "bun",
  alias: {},
});
await Promise.all([
  buildView("launcherview", path.join(workspace, "apps/launcher/src/views/launcher")),
  buildView("settingsview", path.join(workspace, "apps/launcher/src/views/settings")),
  buildView("managesettingsview", path.join(workspace, "apps/launcher/src/views/manage-settings")),
  buildView("sessionpickerview", path.join(workspace, "apps/launcher/src/views/session-picker")),
  buildView("characterview", path.join(workspace, "apps/launcher/src/views/character")),
  buildView("bosstimersview", path.join(workspace, "apps/launcher/src/views/boss-timers")),
  buildView("mainview", path.join(workspace, "packages/combat/src/mainview")),
  buildView("analysisdetailview", path.join(workspace, "packages/combat/src/analysisdetailview")),
  buildView("deathlogview", path.join(workspace, "packages/combat/src/deathlogview")),
  buildView("overlayview", path.join(workspace, "packages/overlay/src/overlayview")),
  buildView("rewardsview", path.join(workspace, "packages/rewards/src/rewardsview")),
  buildView("catalogview", path.join(workspace, "packages/rewards/src/catalogview")),
  buildView("buildexportview", path.join(workspace, "packages/build-export/src/buildexportview")),
]);

const assets = path.join(views, "assets");
await mkdir(assets, { recursive: true });
await Promise.all([
  copyFile(path.join(workspace, "apps/launcher/assets/icon/eggplant_icon_320px.png"), path.join(assets, "app-icon.png")),
  copyFile(path.join(workspace, "apps/launcher/assets/icon/eggplant_icon.ico"), path.join(assets, "app-icon.ico")),
  copyFile(path.join(workspace, "apps/launcher/assets/icon/eggplant_icon.ico"), path.join(resources, "favicon.ico")),
  cp(path.join(workspace, "apps/launcher/assets/class_icons"), path.join(assets, "class-icons"), { recursive: true }),
  cp(path.join(workspace, "apps/launcher/assets/status-icons"), path.join(assets, "status-icons"), { recursive: true }),
]);

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

async function buildView(name: string, source: string): Promise<void> {
  const destination = path.join(views, name);
  await mkdir(destination, { recursive: true });
  await build({
    entrypoint: path.join(source, "index.tsx"),
    outdir: destination,
    target: "browser",
    alias: {},
  });
  await Promise.all([
    copyFile(path.join(source, "index.css"), path.join(destination, "index.css")),
    copyFile(path.join(workspace, "packages/ui-kit/theme.css"), path.join(destination, "theme.css")),
  ]);
  const html = (await readFile(path.join(source, "index.html"), "utf8")).replaceAll("views://", "/views/");
  await writeFile(path.join(destination, "index.html"), html);
  const jsPath = path.join(destination, "index.js");
  const js = (await readFile(jsPath, "utf8")).replaceAll("views://", "/views/");
  await writeFile(jsPath, js);
}

async function build(options: { entrypoint: string; outdir: string; target: "bun" | "browser"; alias: Record<string, string> }): Promise<void> {
  const result = await Bun.build({
    entrypoints: [options.entrypoint], outdir: options.outdir, target: options.target, format: "esm", minify: false, sourcemap: "external",
    ...(options.target === "bun" ? { naming: "index.[ext]" } : {}),
    plugins: [{ name: "neutralino-runtime-alias", setup(builder) {
      for (const [specifier, replacement] of Object.entries(options.alias)) {
        builder.onResolve({ filter: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}$`) }, () => ({ path: replacement }));
      }
    } }],
  });
  if (!result.success) throw new AggregateError(result.logs, `Build failed: ${options.entrypoint}`);
}
