import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { replaceWindowsExecutableIcon } from "./windows-executable-icon.ts";

function requiredEnvironmentValue(name: string): string {
  const value = Bun.env[name];
  if (!value) throw new Error(`${name} is required when embedding the Electrobun Windows installer icon.`);
  return value;
}

function runTar(arguments_: string[]): void {
  const result = Bun.spawnSync(["tar.exe", ...arguments_], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
}

if (Bun.env["ELECTROBUN_OS"] === "win" && Bun.env["ELECTROBUN_BUILD_ENV"] !== "dev") {
  const buildDirectory = requiredEnvironmentValue("ELECTROBUN_BUILD_DIR");
  const artifactDirectory = requiredEnvironmentValue("ELECTROBUN_ARTIFACT_DIR");
  const iconPath = path.join(buildDirectory, "app-icon.ico");
  if (!existsSync(iconPath)) throw new Error(`Electrobun installer icon input is missing: ${iconPath}`);

  const installerArchives = (await readdir(artifactDirectory))
    .filter((name) => name.endsWith("-Setup.zip"));
  if (installerArchives.length !== 1) {
    throw new Error(`Expected one Electrobun Windows installer archive, found ${installerArchives.length}.`);
  }

  const installerArchivePath = path.join(artifactDirectory, installerArchives[0]!);
  const stagingDirectory = path.join(buildDirectory, ".installer-icon-staging");
  const repackedArchivePath = path.join(buildDirectory, "installer-with-icon.zip");

  await rm(stagingDirectory, { force: true, recursive: true });
  await rm(repackedArchivePath, { force: true });
  await mkdir(stagingDirectory, { recursive: true });

  try {
    runTar(["-xf", installerArchivePath, "-C", stagingDirectory]);
    const installerExecutable = (await readdir(stagingDirectory, { withFileTypes: true }))
      .find((entry) => entry.isFile() && entry.name.endsWith("-Setup.exe"));
    if (!installerExecutable) throw new Error("The Electrobun installer archive does not contain a setup executable.");

    await replaceWindowsExecutableIcon(path.join(stagingDirectory, installerExecutable.name), iconPath);
    runTar(["-a", "-cf", repackedArchivePath, "-C", stagingDirectory, "."]);
    await copyFile(repackedArchivePath, installerArchivePath);
    await copyFile(iconPath, path.join(buildDirectory, "app-icon.ico"));
    console.log(`Embedded the application icon into ${installerExecutable.name}.`);
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
    await rm(repackedArchivePath, { force: true });
  }
}
