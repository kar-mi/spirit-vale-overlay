import { existsSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";

import { replaceWindowsExecutableIcon } from "./windows-executable-icon.ts";

function requiredEnvironmentValue(name: string): string {
  const value = Bun.env[name];
  if (!value) throw new Error(`${name} is required when embedding the Electrobun Windows icon.`);
  return value;
}

if (Bun.env["ELECTROBUN_OS"] === "win") {
  const buildDirectory = requiredEnvironmentValue("ELECTROBUN_BUILD_DIR");
  const appName = requiredEnvironmentValue("ELECTROBUN_APP_NAME");
  const appDirectory = path.join(buildDirectory, appName);
  const iconPath = path.resolve(import.meta.dir, "../static/icon/eggplant_icon.ico");
  const buildIconPath = path.join(buildDirectory, "app-icon.ico");
  const executablePaths = [
    path.join(appDirectory, "bin", "launcher.exe"),
    path.join(appDirectory, "bin", "bun.exe"),
  ];

  for (const requiredPath of [iconPath, ...executablePaths]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`Electrobun icon input is missing: ${requiredPath}`);
    }
  }

  await Promise.all(
    executablePaths.map((executablePath) => replaceWindowsExecutableIcon(executablePath, iconPath)),
  );
  await copyFile(iconPath, buildIconPath);
  console.log(`Embedded the application icon into ${executablePaths.length} Windows executables.`);
}
