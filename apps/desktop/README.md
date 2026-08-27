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

Neutralino writes the Windows-only `apps/desktop/dist/spirit-vale-overlay-release.zip`; the release workflow publishes it as `spirit-vale-overlay-windows-x64-vX.Y.Z.zip`. Run `spirit-vale-overlay-win_x64.exe` after extracting it. Its `.spirit-vale-portable` marker keeps logs, settings, WebView2 state, and temporary files beside the app by default. Users can close the app and delete the marker to store new data under `%APPDATA%\Spirit Vale Overlay\data`; existing portable settings are not moved automatically.

## Runtime architecture

The Neutralino client never exposes its native token to the Bun-facing RPC server. The extension broadcasts a short-lived, one-use ticket to the launcher, and every child window receives its own ticket. The RPC server listens only on `127.0.0.1`.

Neutralino starts configured extensions for every child-window process. An atomic owner file permits exactly one Bun backend per application tree; child extensions detect the live owner and exit before connecting or initializing capture.

The Bun extension is launched with `--no-orphans`, so force-closing its owning Neutralino process also terminates the backend and native helper descendants.
