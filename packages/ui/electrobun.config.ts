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
 * same `theme.css` into every view's own folder needs a textually distinct source key per
 * view even though every one resolves to the same file — otherwise the object literal would
 * silently collapse duplicate keys and most views would end up without a theme.css.
 */
function themeCssSource(variant: number): string {
  return `../ui-core/${"./".repeat(variant)}theme.css`;
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
      launcherview: { entrypoint: "src/launcherview/index.tsx" },
      settingsview: { entrypoint: "src/settingsview/index.tsx" },
      mainview: { entrypoint: "../combat-ui/src/mainview/index.tsx" },
      overlayview: { entrypoint: "../overlay/src/overlayview/index.tsx" },
      characterview: { entrypoint: "src/characterview/index.tsx" },
      marketview: { entrypoint: "../market-ui/src/marketview/index.tsx" },
      marketfiltersview: { entrypoint: "../market-ui/src/marketfiltersview/index.tsx" },
      rewardsview: { entrypoint: "../rewards-ui/src/rewardsview/index.tsx" },
      rewardscatalogview: { entrypoint: "../rewards-ui/src/catalogview/index.tsx" },
      sessionpickerview: { entrypoint: "src/sessionpickerview/index.tsx" },
      analysisdetailview: { entrypoint: "../combat-ui/src/analysisdetailview/index.tsx" },
      deathlogview: { entrypoint: "../combat-ui/src/deathlogview/index.tsx" },
      buildexportview: { entrypoint: "../build-export/src/buildexportview/index.tsx" },
    },
    copy: {
      "../../static/icon/eggplant_icon_320px.png": "views/assets/app-icon.png",
      "../../static/icon/eggplant_icon.ico": "views/assets/app-icon.ico",
      "../../static/class_icons/class-acolyte.webp": "views/assets/class-icons/class-acolyte.webp",
      "../../static/class_icons/class-berserker.webp": "views/assets/class-icons/class-berserker.webp",
      "../../static/class_icons/class-gunslinger.webp": "views/assets/class-icons/class-gunslinger.webp",
      "../../static/class_icons/class-knight.webp": "views/assets/class-icons/class-knight.webp",
      "../../static/class_icons/class-mage.webp": "views/assets/class-icons/class-mage.webp",
      "../../static/class_icons/class-necromancer.webp": "views/assets/class-icons/class-necromancer.webp",
      "../../static/class_icons/class-paladin.webp": "views/assets/class-icons/class-paladin.webp",
      "../../static/class_icons/class-priest.webp": "views/assets/class-icons/class-priest.webp",
      "../../static/class_icons/class-rogue.webp": "views/assets/class-icons/class-rogue.webp",
      "../../static/class_icons/class-scout.webp": "views/assets/class-icons/class-scout.webp",
      "../../static/class_icons/class-shinobi.webp": "views/assets/class-icons/class-shinobi.webp",
      "../../static/class_icons/class-summoner.webp": "views/assets/class-icons/class-summoner.webp",
      "../../static/class_icons/class-warrior.webp": "views/assets/class-icons/class-warrior.webp",
      "../../static/class_icons/class-weaver.webp": "views/assets/class-icons/class-weaver.webp",
      "../../static/class_icons/class-wizard.webp": "views/assets/class-icons/class-wizard.webp",
      // Status *and* skill artwork share this folder: a summon or toggle is tracked under its skill
      // id, so the tracker resolves its sprite from the skill catalog, and the renderer resolves
      // every sprite id from one base path.
      ...directoryCopy("../../static/status-icons", "views/assets/status-icons"),
      "src/launcherview/index.html": "views/launcherview/index.html",
      "src/launcherview/index.css": "views/launcherview/index.css",
      [themeCssSource(0)]: "views/launcherview/theme.css",
      "src/settingsview/index.html": "views/settingsview/index.html",
      "src/settingsview/index.css": "views/settingsview/index.css",
      [themeCssSource(1)]: "views/settingsview/theme.css",
      "../combat-ui/src/mainview/index.html": "views/mainview/index.html",
      "../combat-ui/src/mainview/index.css": "views/mainview/index.css",
      [themeCssSource(2)]: "views/mainview/theme.css",
      "../overlay/src/overlayview/index.html": "views/overlayview/index.html",
      "../overlay/src/overlayview/index.css": "views/overlayview/index.css",
      [themeCssSource(12)]: "views/overlayview/theme.css",
      "src/characterview/index.html": "views/characterview/index.html",
      "src/characterview/index.css": "views/characterview/index.css",
      [themeCssSource(4)]: "views/characterview/theme.css",
      "../market-ui/src/marketview/index.html": "views/marketview/index.html",
      "../market-ui/src/marketview/index.css": "views/marketview/index.css",
      [themeCssSource(5)]: "views/marketview/theme.css",
      "../market-ui/src/marketfiltersview/index.html": "views/marketfiltersview/index.html",
      "../market-ui/src/marketfiltersview/index.css": "views/marketfiltersview/index.css",
      [themeCssSource(6)]: "views/marketfiltersview/theme.css",
      "../rewards-ui/src/rewardsview/index.html": "views/rewardsview/index.html",
      "../rewards-ui/src/rewardsview/index.css": "views/rewardsview/index.css",
      [themeCssSource(7)]: "views/rewardsview/theme.css",
      "../rewards-ui/src/catalogview/index.html": "views/rewardscatalogview/index.html",
      "../rewards-ui/src/catalogview/index.css": "views/rewardscatalogview/index.css",
      [themeCssSource(8)]: "views/rewardscatalogview/theme.css",
      "src/sessionpickerview/index.html": "views/sessionpickerview/index.html",
      "src/sessionpickerview/index.css": "views/sessionpickerview/index.css",
      [themeCssSource(9)]: "views/sessionpickerview/theme.css",
      "../combat-ui/src/analysisdetailview/index.html": "views/analysisdetailview/index.html",
      "../combat-ui/src/analysisdetailview/index.css": "views/analysisdetailview/index.css",
      [themeCssSource(11)]: "views/analysisdetailview/theme.css",
      "../combat-ui/src/deathlogview/index.html": "views/deathlogview/index.html",
      "../combat-ui/src/deathlogview/index.css": "views/deathlogview/index.css",
      [themeCssSource(14)]: "views/deathlogview/theme.css",
      "../build-export/src/buildexportview/index.html": "views/buildexportview/index.html",
      "../build-export/src/buildexportview/index.css": "views/buildexportview/index.css",
      [themeCssSource(3)]: "views/buildexportview/theme.css",
    },
    buildFolder: "dist/electrobun",
    artifactFolder: "dist/artifacts",
    targets: "win-x64",
    watch: ["src", "../build-export/src", "../combat-ui/src", "../market-ui/src", "../overlay/src", "../rewards-ui/src", "../ui-core"],
    win: {
      bundleCEF: false,
      defaultRenderer: "native",
    },
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  scripts: {
    postBuild: "../../scripts/embed-electrobun-windows-icon.ts",
    postPackage: "../../scripts/embed-electrobun-windows-installer-icon.ts",
  },
} satisfies ElectrobunConfig;
