import { cp, mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import type { BunPlugin } from "bun";

const VIEW_SOURCES: Record<string, string> = {
  launcherview: "apps/launcher/src/views/launcher",
  settingsview: "apps/launcher/src/views/settings",
  sessionpickerview: "apps/launcher/src/views/session-picker",
  characterview: "apps/launcher/src/views/character",
  bosstimersview: "apps/launcher/src/views/boss-timers",
  mainview: "packages/combat/src/mainview",
  analysisdetailview: "packages/combat/src/analysisdetailview",
  deathlogview: "packages/combat/src/deathlogview",
  overlayview: "packages/overlay/src/overlayview",
  rewardsview: "packages/rewards/src/rewardsview",
  catalogview: "packages/rewards/src/catalogview",
  buildexportview: "packages/build-export/src/buildexportview",
};

export async function bundle(options: {
  entrypoint: string;
  outdir: string;
  target: "bun" | "browser";
  plugins?: BunPlugin[];
}): Promise<void> {
  const result = await Bun.build({
    entrypoints: [options.entrypoint],
    outdir: options.outdir,
    target: options.target,
    format: "esm",
    minify: false,
    sourcemap: "external",
    ...(options.plugins ? { plugins: options.plugins } : {}),
    ...(options.target === "bun" ? { naming: "index.[ext]" } : {}),
  });
  if (!result.success) throw new AggregateError(result.logs, `Build failed: ${options.entrypoint}`);
}

/** Rewrite the `views://` scheme the view sources use into a server-root path. */
export function rewriteViewScheme(source: string): string {
  return source.replaceAll("views://", "/views/");
}

export async function buildViews(options: {
  workspace: string;
  viewsDir: string;
  plugins?: BunPlugin[];
  rewrite?: (source: string) => string;
}): Promise<void> {
  const rewrite = options.rewrite ?? rewriteViewScheme;
  await Promise.all(
    Object.entries(VIEW_SOURCES).map(([name, relativeSource]) =>
      buildView({
        name,
        source: path.join(options.workspace, relativeSource),
        viewsDir: options.viewsDir,
        workspace: options.workspace,
        plugins: options.plugins,
        rewrite,
      }),
    ),
  );
}

async function buildView(options: {
  name: string;
  source: string;
  viewsDir: string;
  workspace: string;
  plugins?: BunPlugin[];
  rewrite: (source: string) => string;
}): Promise<void> {
  const destination = path.join(options.viewsDir, options.name);
  await mkdir(destination, { recursive: true });
  await bundle({
    entrypoint: path.join(options.source, "index.tsx"),
    outdir: destination,
    target: "browser",
    plugins: options.plugins,
  });
  await Promise.all([
    copyFile(path.join(options.source, "index.css"), path.join(destination, "index.css")),
    copyFile(path.join(options.workspace, "packages/ui-kit/theme.css"), path.join(destination, "theme.css")),
  ]);
  const html = options.rewrite(await readFile(path.join(options.source, "index.html"), "utf8"));
  await writeFile(path.join(destination, "index.html"), html);
  const jsPath = path.join(destination, "index.js");
  const js = options.rewrite(await readFile(jsPath, "utf8"));
  await writeFile(jsPath, js);
}

export async function copyViewAssets(options: {
  workspace: string;
  viewsDir: string;
  resourcesDir: string;
}): Promise<void> {
  const assets = path.join(options.viewsDir, "assets");
  await mkdir(assets, { recursive: true });
  const icon = (relative: string) => path.join(options.workspace, "apps/launcher/assets", relative);
  await Promise.all([
    copyFile(icon("icon/eggplant_icon_320px.png"), path.join(assets, "app-icon.png")),
    copyFile(icon("icon/eggplant_icon.ico"), path.join(assets, "app-icon.ico")),
    copyFile(icon("icon/eggplant_icon.ico"), path.join(options.resourcesDir, "favicon.ico")),
    cp(icon("class_icons"), path.join(assets, "class-icons"), { recursive: true }),
    cp(icon("status-icons"), path.join(assets, "status-icons"), { recursive: true }),
  ]);
}
