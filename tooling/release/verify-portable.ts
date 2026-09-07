import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
// tooling/ is not an npm workspace member, so shared modules are imported by path.
import {
  bundleLayout,
  bundledHotkeyHelperPath,
  bundledRuntimePath,
  electronBundleLayout,
  electronBundledHotkeyHelperPath,
  electronBundledRuntimePath,
} from "../../packages/desktop-platform/bundle-layout.ts";
import { neutralinoDesktopExecutableName } from "../../packages/desktop-platform/executable-names.ts";
import {
  assertBundledBun,
  assertPaths,
  assertReadmeText,
  expandBundle,
  readVersionInfo,
  sharedReadmeText,
  toWindowsFileVersion,
} from "./verify-portable-shared.ts";
import { readWindowsManifest } from "./windows-dpi-manifest.ts";

interface PackageJson {
  version?: string;
  author?: string;
  packageManager?: string;
}

interface NeutralinoConfig {
  version?: string;
  applicationName?: string;
  author?: string;
  description?: string;
  copyright?: string;
  cli?: { binaryName?: string };
}

const projectRoot = path.resolve(import.meta.dir, "..", "..");
const zipArg = process.argv.indexOf("--zip");
const zipOverride = zipArg !== -1 ? process.argv[zipArg + 1] : undefined;

const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as PackageJson;
const version = packageJson.version;
const bunVersion = packageJson.packageManager?.match(/^bun@(.+)$/)?.[1];
if (!version) throw new Error("package.json must define a version before verification.");
if (!bunVersion) throw new Error("package.json must pin Bun via packageManager before verification.");

function checkRoot(shell: string): string {
  return path.join(projectRoot, "dist", `portable-check-${shell}`);
}

async function verifyNeutralino(): Promise<void> {
  const appRoot = path.join(projectRoot, "apps", "desktop");
  const neutralinoConfig = JSON.parse(
    await readFile(path.join(appRoot, "neutralino.config.json"), "utf8"),
  ) as NeutralinoConfig;
  if (neutralinoConfig.version !== version) {
    throw new Error(`neutralino.config.json version ${neutralinoConfig.version ?? "missing"} does not match ${version}.`);
  }

  const bundleName = `spirit-vale-overlay-windows-x64-v${version}`;
  const zipPath = path.resolve(projectRoot, zipOverride ?? path.join(appRoot, "dist", `${bundleName}.zip`));
  const bundleRoot = await expandBundle(zipPath, checkRoot("neutralino"), bundleName, projectRoot);

  assertPaths(bundleRoot, {
    required: [
      bundleLayout.portableMarker,
      bundleLayout.portableReadme,
      bundleLayout.resourceBundle,
      bundleLayout.backendEntrypoint,
      bundleLayout.backendSourceMap,
      bundledRuntimePath("win32"),
      bundledHotkeyHelperPath("win32"),
      neutralinoDesktopExecutableName("win32", "x64"),
    ],
    forbidden: [
      ".tmp",
      bundleLayout.backendOwnerFile,
      bundleLayout.backendLog,
      bundleLayout.neutralinoLog,
      "error.log",
      "data",
      "spirit-vale-overlay-linux_arm64",
      "spirit-vale-overlay-linux_armhf",
      "spirit-vale-overlay-linux_x64",
      "spirit-vale-overlay-mac_arm64",
      "spirit-vale-overlay-mac_universal",
      "spirit-vale-overlay-mac_x64",
      "bin/launcher.exe",
      "Resources/main.js",
      "Resources/build.json",
      "Resources/version.json",
      "Spirit Vale Overlay-Setup.exe",
      "Spirit Vale Overlay-Setup.metadata.json",
      "Spirit Vale Overlay-Setup.tar.zst",
      "SpiritValeOverlay-Setup.zip",
      "Info.plist",
    ],
  });

  const metadata = readVersionInfo(path.join(bundleRoot, "spirit-vale-overlay-win_x64.exe"), projectRoot);
  const manifest = await readWindowsManifest(path.join(bundleRoot, "spirit-vale-overlay-win_x64.exe"));
  if (!/PerMonitorV2/i.test(manifest)) {
    throw new Error("Portable executable is not Per-Monitor DPI Awareness V2.");
  }
  const expectedEntries = {
    CompanyName: neutralinoConfig.author,
    FileDescription: neutralinoConfig.description,
    FileVersion: toWindowsFileVersion(version!),
    LegalCopyright: neutralinoConfig.copyright,
    OriginalFilename: neutralinoConfig.cli?.binaryName,
    ProductName: neutralinoConfig.applicationName,
    ProductVersion: version,
  };
  for (const [key, expected] of Object.entries(expectedEntries)) {
    if (!expected) throw new Error(`neutralino.config.json must define metadata for ${key}.`);
    if (metadata[key] !== expected) {
      throw new Error(`Portable executable has ${key} "${metadata[key]}", expected "${expected}".`);
    }
  }

  assertBundledBun(path.join(bundleRoot, "extensions", "bin", "bun.exe"), bunVersion!, projectRoot);
  await assertReadmeText(path.join(bundleRoot, bundleLayout.portableReadme), [
    'run "spirit-vale-overlay-win_x64.exe"',
    ...sharedReadmeText,
  ]);

  console.log(`Neutralino Windows release ZIP verified: ${zipPath}`);
}

async function verifyElectron(): Promise<void> {
  const appRoot = path.join(projectRoot, "apps", "desktop-electron");
  const builderConfig = createRequire(import.meta.url)(
    path.join(appRoot, "electron-builder.config.cjs"),
  ) as { copyright: string; win: { signAndEditExecutable: boolean } };

  const bundleName = `spirit-vale-overlay-electron-windows-x64-v${version}`;
  const zipPath = path.resolve(projectRoot, zipOverride ?? path.join(appRoot, "dist", `${bundleName}.zip`));
  const bundleRoot = await expandBundle(zipPath, checkRoot("electron"), bundleName, projectRoot);

  assertPaths(bundleRoot, {
    required: [
      electronBundleLayout.portableMarker,
      electronBundleLayout.portableReadme,
      electronBundleLayout.desktopExecutable,
      electronBundleLayout.asarPath,
      electronBundleLayout.launcherEntrypoint,
      electronBundleLayout.backendEntrypoint,
      electronBundledRuntimePath("win32"),
      electronBundledHotkeyHelperPath("win32"),
    ],
    forbidden: [
      ".tmp",
      "data",
      "error.log",
      electronBundleLayout.backendLog,
      bundleLayout.backendLog,
      bundleLayout.neutralinoLog,
      "resources/app.asar.unpacked",
      "Spirit Vale Overlay Setup.exe",
      "Spirit Vale Overlay-Setup.exe",
    ],
  });

  const metadata = readVersionInfo(path.join(bundleRoot, electronBundleLayout.desktopExecutable), projectRoot);
  if (builderConfig.win.signAndEditExecutable) {
    // CI can run electron-builder's rcedit pass, so the exe carries our branding.
    const expectedEntries = {
      CompanyName: packageJson.author,
      // electron-builder's rcedit pass writes FileVersion as the raw semver string but
      // pads ProductVersion to the 4-part Windows form.
      FileVersion: version,
      LegalCopyright: builderConfig.copyright,
      ProductName: "Spirit Vale Overlay",
      ProductVersion: toWindowsFileVersion(version!),
    };
    for (const [key, expected] of Object.entries(expectedEntries)) {
      if (metadata[key] !== expected) {
        throw new Error(`Electron executable has ${key} "${metadata[key]}", expected "${expected}".`);
      }
    }
  } else if (metadata.ProductName !== "Electron") {
    // Local builds skip the rcedit pass, so the exe must still be Electron's own —
    // a stamped ProductName here means the config drifted.
    throw new Error(`Electron executable ProductName is "${metadata.ProductName}", expected the unedited "Electron".`);
  }

  assertBundledBun(
    path.join(bundleRoot, ...electronBundledRuntimePath("win32").split("/")),
    bunVersion!,
    projectRoot,
  );
  await assertReadmeText(path.join(bundleRoot, electronBundleLayout.portableReadme), [
    'run "Spirit Vale Overlay.exe"',
    ...sharedReadmeText,
  ]);

  console.log(`Electron Windows release ZIP verified: ${zipPath}`);
}

const shellArg = process.argv.indexOf("--shell");
const shell = shellArg !== -1 ? process.argv[shellArg + 1] : "neutralino";
if (shell === "neutralino") await verifyNeutralino();
else if (shell === "electron") await verifyElectron();
else throw new Error(`Unknown --shell "${shell}"; expected "neutralino" or "electron".`);
