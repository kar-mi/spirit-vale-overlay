import { existsSync } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";

import { replaceWindowsExecutableIcon } from "./windows-executable-icon.ts";
import { productName, setWindowsExecutableMetadata } from "./windows-executable-metadata.ts";

interface PackageJson {
  version?: string;
}

function requiredEnvironmentValue(name: string): string {
  const value = Bun.env[name];
  if (!value) throw new Error(`${name} is required when embedding the Electrobun Windows icon.`);
  return value;
}

if (Bun.env["ELECTROBUN_OS"] === "win") {
  const buildDirectory = requiredEnvironmentValue("ELECTROBUN_BUILD_DIR");
  const appName = requiredEnvironmentValue("ELECTROBUN_APP_NAME");
  const appDirectory = path.join(buildDirectory, appName);
  const iconPath = path.resolve(import.meta.dir, "../../apps/launcher/assets/icon/eggplant_icon.ico");
  const buildIconPath = path.join(buildDirectory, "app-icon.ico");
  const packageJson = JSON.parse(
    await readFile(path.resolve(import.meta.dir, "../../package.json"), "utf8"),
  ) as PackageJson;
  const version = packageJson.version;
  if (!version) throw new Error("package.json must define a version before embedding Windows metadata.");

  const executables = [
    { path: path.join(appDirectory, "bin", "launcher.exe"), fileDescription: `${productName} Launcher` },
  ];

  for (const requiredPath of [iconPath, ...executables.map((executable) => executable.path)]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`Electrobun icon input is missing: ${requiredPath}`);
    }
  }

  for (const executable of executables) {
    await replaceWindowsExecutableIcon(executable.path, iconPath);
    await setWindowsExecutableMetadata(executable.path, {
      fileDescription: executable.fileDescription,
      version,
    });
  }
  const shortcutHelperPath = path.join(appDirectory, "bin", "sv-overlay-hotkeys.exe");
  const helperBuild = Bun.spawnSync([
    "powershell",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.resolve(import.meta.dir, "build-pass-through-shortcuts.ps1"),
    "-OutputPath",
    shortcutHelperPath,
  ], { stdout: "inherit", stderr: "inherit" });
  if (helperBuild.exitCode !== 0) throw new Error(`Could not build the pass-through shortcut helper (${helperBuild.exitCode}).`);
  await copyFile(iconPath, buildIconPath);
  console.log(`Embedded the application icon and version metadata into ${executables.length} Windows executables and built the pass-through shortcut helper.`);
}
