# Neutralino POC

This is a deliberately bounded migration spike. It reuses the production launcher view, packet capture coordinator, overlay controller, overlay view, settings files, and pass-through hotkey helper. Neutralino owns the native launcher and transparent overlay windows; a bundled Bun executable runs as an authenticated Neutralino extension.

Included: launcher status and adapter selection, real Npcap capture, XP/boss/minimap/status data, multi-monitor transparent overlay surfaces, always-on-top/click-through behavior, tray controls, and portable data paths.

Not included: the combat, rewards, character, build-export, boss-timer, settings, manage-settings, updater, and installer windows. Their launcher buttons show a POC boundary notice.

## Run

From the repository root:

```powershell
bun install
bun run --filter @svoverlay/neutralino-poc update
bun run dev:neutralino-poc
```

`update` downloads the pinned Neutralino 6.9.0 native binaries and only needs to be repeated after changing that version or cleaning `apps/neutralino-poc/bin`.

The development script builds and launches an unpacked local application bundle. Neutralino's directory-resource development mode does not start this POC's configured Bun extension, so `neu run` is intentionally not used here. Re-run the command after source changes; the extra build step takes a few seconds.

## Build and package

```powershell
bun run build:neutralino-poc
bun run package:neutralino-poc
```

The portable Windows folder is written to `apps/neutralino-poc/dist/portable/SpiritValeOverlay-Neutralino-POC`. Its `.spirit-vale-portable` marker keeps logs, settings, WebView2 state, and temporary files beside the app.

## Architecture

The Neutralino client never exposes its native token to the Bun-facing RPC server. The extension broadcasts a short-lived, one-use ticket to the launcher; child overlay URLs receive their own ticket. The RPC server listens only on `127.0.0.1`. Window creation stays in the Neutralino client because `window.create` is a client convenience API, while the extension resolves the returned Windows PID to an HWND for click-through styles.

Neutralino starts configured extensions for every child-window process. An atomic owner file therefore permits exactly one Bun backend per application tree; overlay child extensions detect the live owner and exit before connecting or initializing capture. Stale owner files are reclaimed on the next launch.
