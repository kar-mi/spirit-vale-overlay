import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as ResEdit from "resedit";

import config from "../../electrobun.config.ts";

test("Electrobun Bun entrypoint emits the index.js filename required by the Windows launcher", () => {
  expect(path.basename(config.build.bun.entrypoint)).toBe("index.ts");
});

test("Electrobun does not copy runtime definition JSON", () => {
  const destinations = Object.values(config.build.copy);
  expect(destinations.some((destination) => destination.startsWith("bun/maps/"))).toBe(false);
});

test("Electrobun builds the DPS view and overlay without a separate overlay settings view", () => {
  expect(config.build.views.mainview).toEqual({ entrypoint: "../../packages/combat/src/mainview/index.tsx" });
  expect(config.build.views.overlayview).toEqual({ entrypoint: "../../packages/overlay/src/overlayview/index.tsx" });
  expect("overlaysettingsview" in config.build.views).toBe(false);
  expect(config.build.copy["../../packages/overlay/src/overlayview/index.html"]).toBe("views/overlayview/index.html");
  expect("../../packages/overlay/src/overlaysettingsview/index.html" in config.build.copy).toBe(false);
});

test("Electrobun builds the embedded combat analysis and player-detail view", () => {
  expect("analysisview" in config.build.views).toBe(false);
  expect(config.build.views.analysisdetailview).toEqual({ entrypoint: "../../packages/combat/src/analysisdetailview/index.tsx" });
  expect("../../packages/combat/src/analysisview/index.html" in config.build.copy).toBe(false);
  expect(config.build.copy["../../packages/combat/src/analysisdetailview/index.html"]).toBe("views/analysisdetailview/index.html");
});

test("every configured static asset source exists", () => {
  for (const source of Object.keys(config.build.copy)) {
    expect(existsSync(path.resolve(import.meta.dir, "../..", source))).toBe(true);
  }
});

test("Electrobun delegates Windows icon embedding to the project hooks", async () => {
  expect("icon" in config.build.win).toBe(false);
  expect(config.build.copy["assets/icon/eggplant_icon_320px.png"]).toBe("views/assets/app-icon.png");
  expect(config.scripts?.postBuild).toBe("../../tooling/release/embed-electrobun-windows-icon.ts");
  expect(config.scripts?.postPackage).toBe("../../tooling/release/embed-electrobun-windows-installer-icon.ts");

  const iconPath = path.resolve(import.meta.dir, "../../assets/icon/eggplant_icon.ico");
  expect(existsSync(iconPath)).toBe(true);
  expect(ResEdit.Data.IconFile.from(await readFile(iconPath)).icons.length).toBeGreaterThan(1);
});
