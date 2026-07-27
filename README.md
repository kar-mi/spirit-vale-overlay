# Spirit Vale

Spirit Vale is a passive Windows companion app for live combat, character, reward, market, and in-game overlay information. It uses your existing Npcap installation in non-promiscuous mode and never sends, modifies, drops, or injects game traffic.

**[Jump to Installation ↓](#installation)**

> Looking for the pacakges to use for development? See
> [spirit-vale-tools](https://github.com/kar-mi/spirit-vale-tools).

> **Overlay hotkeys:** `F5` resets/refreshes the overlay, `F9` shows or hides
> the overlay, and `F11` unlocks the overlay for editing (drag and resize
> elements, then press `F11` again to lock).

## Features

The launcher gives you quick access to combat DPS, overlay settings, rewards,
market, and character tools.

![Launcher window](docs/img/launcher_window.png)

The in-game overlay shows live party DPS along with HP/MP during combat.

![In-game DPS overlay](docs/img/dps_overlay.png)

Press `F11` to unlock the overlay and drag elements into the layout you want.

![Editing the overlay layout](docs/img/edit_overlay.png)

Review full combat logs with per-player damage, DPS, crit rate, and kills.

![Combat log analysis](docs/img/combat_logs.png)

The death log breaks down the hits taken in the seconds leading up to a death.

![Death log](docs/img/death_log.png)

## Installation

### Pre-install

Before installing Spirit Vale, download and install Npcap from
[npcap.com/#download](https://npcap.com/#download). Select **Install Npcap in
WinPcap API-compatible Mode** and leave **Restrict Npcap driver's access to
Administrators only** unchecked.

![Required Npcap installation options](docs/img/npcap_option.png)

### Portable release

1. Download the latest `Spirit-Vale-portable-win-x64-v*.zip` from [GitHub Releases](https://github.com/kar-mi/spirit-vale-overlay/releases/latest).
2. Extract the complete ZIP.
3. Run the top-level `Spirit Vale.exe`.

The portable app keeps its settings, logs, and writable runtime data inside the extracted folder.

### Run from source

This path is only for developers building the application. It requires Bun 1.3.13 or newer and access to the `@kar-mi/spirit-vale-tools-*` GitHub Packages.

Create a local `.npmrc` file

```ini
@kar-mi:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Authenticate your existing GitHub CLI session with `read:packages`, then install and run the application:

```powershell
gh auth login --hostname github.com --web --scopes read:packages
$env:NODE_AUTH_TOKEN = gh auth token
bun install
bun run dev
```

To verify or package a source build:

```powershell
bun run check
bun run build
bun run package:portable
bun run verify:portable
```

## Releases

See [RELEASE.md](RELEASE.md) for GitHub setup and Windows release instructions.
