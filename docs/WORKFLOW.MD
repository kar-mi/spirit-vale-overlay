# Development workflow

Spirit Vale Overlay is a private Bun-workspace monorepo for one Windows desktop product. The
launcher is the only deployable application; the remaining workspaces provide shared platform/UI
code or individual product features.

## Repository layout

```text
apps/
  launcher/                    # @svoverlay/launcher: the desktop application
    assets/                     # application icon and renderer artwork
    src/
      desktop/                  # Electrobun/Bun process, capture, native windows, storage
      launcher/                 # launcher settings, state/RPC types, update checks
      character/                # character cache and character-view RPC contract
      views/                    # launcher-owned Preact renderer entrypoints
      shared/types/             # launcher-wide declarations
    electrobun.config.ts        # application build, views, copied resources, hooks

packages/
  build-export/                 # planner/build export feature
  combat/                       # DPS, analysis, and death-log feature
  market/                       # market feature
  overlay/                      # in-game overlay feature
  rewards/                      # rewards feature
  ui-kit/                       # renderer-safe Preact components and theme
  desktop-platform/             # Bun/Electrobun/Windows and local persistence helpers
  contracts/                    # cross-feature contracts

tooling/release/                # Windows metadata, portable packaging, verification
docs/                           # contributor and product documentation
```

The root `package.json` owns the product version, Bun lockfile, shared commands, and release tag
format. Workspace packages are all private and use the `@svoverlay/*` namespace.

## Ownership rules

- `@svoverlay/launcher` is the composition root: it starts capture, owns the tray and shared
  Settings window, and opens feature windows.
- Feature packages own their domain state, window factory, renderer views, and tests. They must not
  import launcher internals or another feature's implementation.
- `@svoverlay/ui-kit` contains browser/Preact-safe UI code only.
- `@svoverlay/desktop-platform` contains runtime-specific code: Electrobun windows, Windows APIs,
  persistence, window placement, UI scaling, and lifecycle helpers.
- `@svoverlay/contracts` contains narrow types shared across feature boundaries. Add a contract
  there instead of importing another feature package's internal files.

Use a workspace package's declared exports, never a relative path into another workspace.

## Launcher source layout

```text
apps/launcher/src/
  desktop/                      # code that runs in the Bun/Electrobun process
  launcher/                     # launcher settings, state, RPC and update logic
  character/                    # character cache and Character RPC contract
  views/
    launcher/                   # launcher renderer
    settings/                   # shared Settings renderer
    character/                  # character renderer
    session-picker/             # session-picker renderer
```

`desktop/` is a project convention, not a Bun requirement. It makes the execution boundary clear:
files in it may use Bun, Node APIs, Electrobun, and native Windows behavior; `views/` files are
renderer entrypoints and should remain browser-safe except for Electrobun's view RPC API.

## Electrobun views

`apps/launcher/electrobun.config.ts` is the authoritative build map. A view ID is the stable name
used by the built application and its `views/<id>/` output folder; it does not need to match its
source-directory name.

| View ID | Source owner |
| --- | --- |
| `launcherview` | `apps/launcher/src/views/launcher` |
| `settingsview` | `apps/launcher/src/views/settings` |
| `characterview` | `apps/launcher/src/views/character` |
| `sessionpickerview` | `apps/launcher/src/views/session-picker` |
| `mainview`, `analysisdetailview`, `deathlogview` | `@svoverlay/combat` |
| `overlayview` | `@svoverlay/overlay` |
| `marketview`, `marketfiltersview` | `@svoverlay/market` |
| `rewardsview`, `rewardscatalogview` | `@svoverlay/rewards` |
| `buildexportview` | `@svoverlay/build-export` |

When adding a view, add its TypeScript entrypoint and copied HTML/CSS/theme resources to the
Electrobun config, then add or update a configuration test. Keep existing IDs unless the runtime
URLs and packaged resource destinations are intentionally changing.

## Daily commands

Run these from the repository root:

```powershell
bun install                 # install/update workspace dependencies
bun run dev                 # start the launcher in Electrobun development mode
bun run typecheck           # check all TypeScript sources
bun test                    # run all workspace tests
bun run check               # typecheck, then run all tests
bun run build               # build the Windows desktop application
bun run package:portable    # create and verify the portable Windows ZIP
```

To target the launcher directly, use Bun's workspace filter:

```powershell
bun run --filter @svoverlay/launcher dev
bun run --filter @svoverlay/launcher build
```

## Change workflow

1. Place the work in the owning launcher area or feature package; extract shared behavior only
   when at least two consumers need it.
2. Keep Bun/Electrobun/native code in `desktop-platform` or `apps/launcher/src/desktop`, and keep
   reusable renderer code in `ui-kit`.
3. Add or update colocated `*.test.ts` files for behavior changes.
4. Run `bun run typecheck` and the focused tests while iterating; run `bun run check` before
   handoff. Changes to assets, views, runtime startup, or packaging also require `bun run build`.
5. For a release-layout change, run `bun run package:portable`; it builds the stable launcher,
   creates the ZIP, and invokes portable verification automatically.

## Releases and persisted data

The root version drives the `app-v<version>` release tag and the portable artifact name. Packaging
code lives in `tooling/release/`; CI is defined in `.github/workflows/`.

Do not casually rename persisted settings or data paths. The portable app must continue to use
`data/settings/`, `data/logs/`, and `data/runtime/` beneath the extracted application folder.
