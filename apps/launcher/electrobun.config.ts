import { readdirSync, readFileSync } from "node:fs";
import type { ElectrobunConfig } from "electrobun";

interface PackageJson {
  version?: string;
}

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as PackageJson;
if (!packageJson.version) throw new Error("package.json must define a version before building Electrobun.");

/**
 * Electrobun's `copy` config is a plain `{ [sourcePath]: destPath }` map, so copying the
 * the shared theme modules into every view's folder needs textually distinct source keys even
 * though they resolve to the same files. Otherwise the object literal would collapse duplicate
 * keys and most views would end up without their imported CSS.
 */
const THEME_CSS_FILES = ["theme.css", "foundation.css", "controls.css", "tables.css", "forms.css", "window-resize.css", "charts.css"] as const;

function themeCssCopies(variant: number, destinationDirectory: string): Record<string, string> {
  return Object.fromEntries(THEME_CSS_FILES.map((name, index) => [
    `../../packages/ui-kit/${"./".repeat(variant * THEME_CSS_FILES.length + index)}${name}`,
    `${destinationDirectory}/${name}`,
  ]));
}

/**
 * Enumerates a directory into Electrobun's per-file `copy` map.
 *
 * `copy` takes one entry per file, but the status icons are keyed off the bundled status and skill
 * catalogs, so any hand-written list goes stale the moment those move. A silently missing icon is
 * especially unhelpful here: `StatusCell` drops a cell whose artwork fails to load, so the buff
 * simply never appears rather than showing a broken frame.
 */
function directoryCopy(sourceDirectory: string, destinationDirectory: string): Record<string, string> {
  const entries = readdirSync(new URL(`${sourceDirectory}/`, import.meta.url));
  return Object.fromEntries(entries.map((name) => [
    `${sourceDirectory}/${name}`,
    `${destinationDirectory}/${name}`,
  ]));
}

export default {
  app: {
    name: "Spirit Vale Overlay",
    identifier: "dev.spiritvale.desktop",
    version: packageJson.version,
    description: "Centralized capture and desktop tools for Spirit Vale.",
  },
  build: {
    bun: { entrypoint: "src/desktop/index.ts" },
    views: {
      launcherview: { entrypoint: "src/views/launcher/index.tsx" },
      settingsview: { entrypoint: "src/views/settings/index.tsx" },
      managesettingsview: { entrypoint: "src/views/manage-settings/index.tsx" },
      mainview: { entrypoint: "../../packages/combat/src/mainview/index.tsx" },
      overlayview: { entrypoint: "../../packages/overlay/src/overlayview/index.tsx" },
      characterview: { entrypoint: "src/views/character/index.tsx" },
      rewardsview: { entrypoint: "../../packages/rewards/src/rewardsview/index.tsx" },
      rewardscatalogview: { entrypoint: "../../packages/rewards/src/catalogview/index.tsx" },
      sessionpickerview: { entrypoint: "src/views/session-picker/index.tsx" },
      analysisdetailview: { entrypoint: "../../packages/combat/src/analysisdetailview/index.tsx" },
      deathlogview: { entrypoint: "../../packages/combat/src/deathlogview/index.tsx" },
      buildexportview: { entrypoint: "../../packages/build-export/src/buildexportview/index.tsx" },
    },
    copy: {
      "assets/icon/eggplant_icon_320px.png": "views/assets/app-icon.png",
      "assets/icon/eggplant_icon.ico": "views/assets/app-icon.ico",
      "assets/class_icons/class-acolyte.webp": "views/assets/class-icons/class-acolyte.webp",
      "assets/class_icons/class-berserker.webp": "views/assets/class-icons/class-berserker.webp",
      "assets/class_icons/class-gunslinger.webp": "views/assets/class-icons/class-gunslinger.webp",
      "assets/class_icons/class-knight.webp": "views/assets/class-icons/class-knight.webp",
      "assets/class_icons/class-mage.webp": "views/assets/class-icons/class-mage.webp",
      "assets/class_icons/class-necromancer.webp": "views/assets/class-icons/class-necromancer.webp",
      "assets/class_icons/class-paladin.webp": "views/assets/class-icons/class-paladin.webp",
      "assets/class_icons/class-priest.webp": "views/assets/class-icons/class-priest.webp",
      "assets/class_icons/class-rogue.webp": "views/assets/class-icons/class-rogue.webp",
      "assets/class_icons/class-scout.webp": "views/assets/class-icons/class-scout.webp",
      "assets/class_icons/class-shinobi.webp": "views/assets/class-icons/class-shinobi.webp",
      "assets/class_icons/class-summoner.webp": "views/assets/class-icons/class-summoner.webp",
      "assets/class_icons/class-warrior.webp": "views/assets/class-icons/class-warrior.webp",
      "assets/class_icons/class-weaver.webp": "views/assets/class-icons/class-weaver.webp",
      "assets/class_icons/class-wizard.webp": "views/assets/class-icons/class-wizard.webp",
      // Status *and* skill artwork share this folder: a summon or toggle is tracked under its skill
      // id, so the tracker resolves its sprite from the skill catalog, and the renderer resolves
      // every sprite id from one base path.
      ...directoryCopy("assets/status-icons", "views/assets/status-icons"),
      "src/views/launcher/index.html": "views/launcherview/index.html",
      "src/views/launcher/index.css": "views/launcherview/index.css",
      ...themeCssCopies(0, "views/launcherview"),
      "src/views/settings/index.html": "views/settingsview/index.html",
      "src/views/settings/index.css": "views/settingsview/index.css",
      ...themeCssCopies(1, "views/settingsview"),
      "src/views/manage-settings/index.html": "views/managesettingsview/index.html",
      "src/views/manage-settings/index.css": "views/managesettingsview/index.css",
      ...themeCssCopies(15, "views/managesettingsview"),
      "../../packages/combat/src/mainview/index.html": "views/mainview/index.html",
      "../../packages/combat/src/mainview/index.css": "views/mainview/index.css",
      ...themeCssCopies(2, "views/mainview"),
      "../../packages/overlay/src/overlayview/index.html": "views/overlayview/index.html",
      "../../packages/overlay/src/overlayview/index.css": "views/overlayview/index.css",
      "../../packages/overlay/src/overlayview/content.css": "views/overlayview/content.css",
      "../../packages/overlay/src/overlayview/elements.css": "views/overlayview/elements.css",
      "../../packages/overlay/src/overlayview/statuses.css": "views/overlayview/statuses.css",
      ...themeCssCopies(12, "views/overlayview"),
      "src/views/character/index.html": "views/characterview/index.html",
      "src/views/character/index.css": "views/characterview/index.css",
      ...themeCssCopies(4, "views/characterview"),
      "../../packages/rewards/src/rewardsview/index.html": "views/rewardsview/index.html",
      "../../packages/rewards/src/rewardsview/index.css": "views/rewardsview/index.css",
      ...themeCssCopies(7, "views/rewardsview"),
      "../../packages/rewards/src/catalogview/index.html": "views/rewardscatalogview/index.html",
      "../../packages/rewards/src/catalogview/index.css": "views/rewardscatalogview/index.css",
      ...themeCssCopies(8, "views/rewardscatalogview"),
      "src/views/session-picker/index.html": "views/sessionpickerview/index.html",
      "src/views/session-picker/index.css": "views/sessionpickerview/index.css",
      ...themeCssCopies(9, "views/sessionpickerview"),
      "../../packages/combat/src/analysisdetailview/index.html": "views/analysisdetailview/index.html",
      "../../packages/combat/src/analysisdetailview/index.css": "views/analysisdetailview/index.css",
      ...themeCssCopies(11, "views/analysisdetailview"),
      "../../packages/combat/src/deathlogview/index.html": "views/deathlogview/index.html",
      "../../packages/combat/src/deathlogview/index.css": "views/deathlogview/index.css",
      ...themeCssCopies(14, "views/deathlogview"),
      "../../packages/build-export/src/buildexportview/index.html": "views/buildexportview/index.html",
      "../../packages/build-export/src/buildexportview/index.css": "views/buildexportview/index.css",
      ...themeCssCopies(3, "views/buildexportview"),
    },
    buildFolder: "dist/electrobun",
    artifactFolder: "dist/artifacts",
    targets: "win-x64",
    watch: ["src", "../../packages/build-export/src", "../../packages/combat/src", "../../packages/overlay/src", "../../packages/rewards/src", "../../packages/ui-kit"],
    win: {
      bundleCEF: false,
      defaultRenderer: "native",
    },
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  scripts: {
    postBuild: "../../tooling/release/embed-electrobun-windows-icon.ts",
  },
} satisfies ElectrobunConfig;
