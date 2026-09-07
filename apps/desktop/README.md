# Spirit Vale Overlay desktop app

Neutralino owns the native windows while a bundled Bun executable runs the application backend as an authenticated Neutralino extension. The launcher, capture, combat, rewards, character, boss timer, build export, settings, and multi-monitor overlay components are bundled as browser views.

## Development

From the repository root:

```powershell
bun install
bun run dev
```

`bun run dev` bundles the backend and views, creates a development application bundle, and launches it under the dev process. Closing or interrupting the dev command stops that application process.

If the pinned Neutralino binaries have not been downloaded yet, run this once:

```powershell
bun run --filter @svoverlay/desktop update
```

## Build and package

```powershell
bun run build
bun run package:portable
```

The package command writes the Windows-only `apps/desktop/dist/spirit-vale-overlay-windows-x64-vX.Y.Z.zip`. The archive contains one folder with the same versioned name; run `spirit-vale-overlay-win_x64.exe` from that folder after extracting it. Its `.spirit-vale-portable` marker keeps logs, settings, WebView2 state, and temporary files beside the app by default. Users can close the app and delete the marker to store new data under `%APPDATA%\Spirit Vale Overlay\data`; existing portable settings are not moved automatically.

## Electron fallback shell

`apps/desktop-electron` (`@svoverlay/desktop-electron`) is a second, feature-equivalent native shell that hosts the same unmodified Bun backend using Chromium instead of WebView2. Neutralino stays the default; reach for Electron only when WebView2 install problems or window/style glitches break the default build.

```powershell
bun run dev:electron
bun run build:electron
bun run package:electron          # -> apps/desktop-electron/dist/spirit-vale-overlay-electron-windows-x64-vX.Y.Z.zip
bun run verify:portable:electron
```

The Electron ZIP is portable the same way (same `.spirit-vale-portable` marker and `data/` layout) but is ~150–200 MB larger, and Electron main additionally redirects Chromium's own `userData`/`temp` into `data/runtime/`. The two shells install and run side by side.

The build signs nothing. `electron-builder.config.cjs` sets `win.signAndEditExecutable` from `process.env.CI`: CI runs electron-builder's rcedit pass and stamps the `.exe`'s VersionInfo + icon; a local `package:electron` skips it (that pass needs a symlink-bearing tool archive that only unpacks with Windows Developer Mode), so the local `.exe`'s file properties read "Electron". Window and taskbar icons are the app's own either way, set at runtime.

Electron keeps the same application-owned window placement data as Neutralino. Its built-in window-state persistence is intentionally unused so the shells do not compete over window bounds. The Bun backend remains a separate process because Electron utility processes provide Node.js rather than Bun's runtime and FFI APIs.

## Runtime architecture

The Neutralino client never exposes its native token to the Bun-facing RPC server. The extension broadcasts a short-lived, one-use ticket to the launcher, and every child window receives its own ticket. The RPC server listens only on `127.0.0.1`.

Neutralino starts configured extensions for every child-window process. An atomic owner file permits exactly one Bun backend per application tree; child extensions detect the live owner and exit before connecting or initializing capture.

The Bun extension is launched with `--no-orphans`, so force-closing its owning Neutralino process also terminates the backend and native helper descendants.
