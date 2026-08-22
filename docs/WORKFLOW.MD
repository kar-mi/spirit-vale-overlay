# Development workflow

## Repository layout

- `apps/desktop/` contains the Neutralino configuration, Bun backend bridge, browser-view bridge, build scripts, and packaging scripts.
- `apps/launcher/` contains launcher orchestration, capture coordination, settings, and launcher-owned views.
- `packages/desktop-platform/` contains framework-neutral window lifecycle, placement, persistence, and Windows-native helpers.
- `packages/combat/`, `packages/overlay/`, `packages/rewards/`, and `packages/build-export/` contain feature controllers and views.
- `packages/contracts/` and `packages/ui-kit/` contain shared browser-safe contracts and UI code.

The Bun backend may use Node/Bun and native Windows APIs. View entrypoints must remain browser-safe and communicate with the backend through `@svoverlay/desktop-runtime/view`.

## Commands

```powershell
bun install
bun run dev
bun run typecheck
bun test
bun run build
bun run package:portable
```

On a fresh checkout, download the pinned Neutralino binaries once:

```powershell
bun run --filter @svoverlay/desktop update
```

`bun run dev` rebuilds the Bun backend and all browser views, builds a local Neutralino development bundle, and launches it as a child of the dev command.

## Adding or changing a view

1. Keep the RPC contract in the owning feature package and use the framework-neutral `RPCSchema` type from `@svoverlay/contracts/rpc`.
2. Create backend RPC with `BrowserView.defineRPC` from `@svoverlay/desktop-runtime`.
3. Create the renderer connection with `DesktopView` from `@svoverlay/desktop-runtime/view`.
4. Add a stable view ID and source directory to `apps/desktop/src/build.ts`.
5. Add lifecycle, placement, and UI-scale tracking through `@svoverlay/desktop-platform` where appropriate.
6. Run type-checks, tests, and a live smoke test of the affected native window behavior.

## Native windows

Neutralino owns each native window. The Bun extension owns application state and authenticated RPC. Transparent overlay windows additionally use the Windows helpers in `apps/desktop/src/backend/win32.ts` for click-through, tool-window, topmost, and visibility behavior.

Neutralino starts extensions for child windows too, so `backend-owner.ts` ensures only the launcher process initializes the Bun backend and capture pipeline.
