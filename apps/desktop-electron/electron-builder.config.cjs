// Config is code (not electron-builder.yml) for one reason: `signAndEditExecutable`
// has to depend on the environment — see the `win` block below.

/** CI runners hold SeCreateSymbolicLinkPrivilege; a typical dev machine does not. */
const canEditExecutable = Boolean(process.env.CI);

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "dev.spiritvale.overlay",
  productName: "Spirit Vale Overlay",
  copyright: "Copyright (C) 2026 kar-mi. Licensed under the GNU AGPL v3.",

  directories: {
    app: "dist",
    output: "release",
  },

  // Only the Electron main/preload bundle goes in the asar.
  asar: true,
  npmRebuild: false,

  files: ["main/**", "package.json"],

  extraResources: [
    { from: "dist/resources/views", to: "views" },
    { from: "dist/resources/extensions", to: "extensions" },
  ],

  // Bundle-root files, next to the exe — the portable marker and its README.
  extraFiles: [
    { from: ".spirit-vale-portable", to: ".spirit-vale-portable" },
    { from: "README.txt", to: "README.txt" },
  ],

  win: {
    // .spirit-vale-portable marker's data/runtime redirection.
    target: ["dir"],
    icon: "../launcher/assets/icon/eggplant_icon.ico",
    artifactName: "spirit-vale-overlay-electron-windows-x64.${ext}",

    // We sign nothing (no cert)
    signAndEditExecutable: canEditExecutable,
  },
};
