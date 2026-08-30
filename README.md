# Spirit Vale Overlay

Spirit Vale Overlay is a passive Windows companion app for live combat, character, reward, and in-game overlay information. It uses your existing Npcap installation in non-promiscuous mode and never sends, modifies, drops, or injects game traffic. Disclaimer for packet capture dps tools, packet capture is based on proxmity, so dps for other players will go down when out of range.

**[Installation guide →](https://kar-mi.github.io/spirit-vale-overlay/install/)** · [Troubleshooting](https://kar-mi.github.io/spirit-vale-overlay/troubleshooting/) · [Discord support](https://discord.gg/XtZbkspzpZ)

The same guides live in this repository: [docs/install/index.md](docs/install/index.md) and
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

> Looking for the pacakges to use for development? See
> [spirit-vale-tools](https://github.com/kar-mi/spirit-vale-tools).

> **Default overlay hotkeys:** `Ctrl+Shift+1` locks or unlocks the overlay, `Ctrl+Shift+2` resets the
> session, `Ctrl+Shift+3` opens the live death log, `Ctrl+Shift+4` shows or hides the overlay,
> `Ctrl+Shift+5` cycles the party meter, `Ctrl+Shift+6` / `Ctrl+Shift+7` reset all-time XP / gold, and
> `Ctrl+Shift+8` cycles the boss timer tile between regions when you have timers in more than one.
> These can be rebound in Settings. Hotkeys pass through to the foreground program, so its normal
> action for the same combination still runs. Windows may also use Ctrl+Shift to switch input languages
> when configured that way.

## Features

The launcher gives you quick access to combat DPS, rewards, and character
tools. The shared Settings window contains general, network, overlay, and keybind
configuration.

![Launcher window](docs/img/launcher_window.png)

The in-game overlay shows live party DPS along with HP/MP during combat.

![In-game DPS overlay](docs/img/dps_overlay.png)

Press `Ctrl+Shift+1` to unlock the overlay and drag elements into the layout you want.

![Editing the overlay layout](docs/img/edit_overlay.png)

Review full combat logs with per-player damage, DPS, crit rate, and kills.

![Combat log analysis](docs/img/combat_logs.png)

The death log breaks down the hits taken in the seconds leading up to a death.

![Death log](docs/img/death_log.png)

## Installation

### Pre-install

Before installing Spirit Vale Overlay, download and install Npcap from
[npcap.com/#download](https://npcap.com/#download). Select **Install Npcap in
WinPcap API-compatible Mode** and leave **Restrict Npcap driver's access to
Administrators only** unchecked.

![Required Npcap installation options](docs/img/npcap_option.png)

### Portable release

1. Download the latest `spirit-vale-overlay-windows-x64-v*.zip` from [GitHub Releases](https://github.com/kar-mi/spirit-vale-overlay/releases/latest).
2. Extract the complete ZIP. It contains one versioned folder, such as `spirit-vale-overlay-windows-x64-v0.10.5`.
3. Open that folder and run `spirit-vale-overlay-win_x64.exe`.

The portable app supports Windows x64 and, by default, keeps its settings, logs, and writable runtime data inside the extracted folder.

To store data in Windows AppData instead:

1. Close Spirit Vale Overlay completely.
2. Delete `.spirit-vale-portable` from the extracted application folder.
3. Restart the app. New data will be stored under `%APPDATA%\Spirit Vale Overlay\data`.

Deleting the marker does not move existing portable data. To keep your current settings, open **Settings > Manage Settings** before deleting it and export them, then import them after restarting. You can also import directly from the old extracted folder's `data` directory.

If the app does not start, shows a blank window, or cannot capture game traffic, see the [Windows troubleshooting guide](docs/TROUBLESHOOTING.md).

### Run from source

This path is only for developers building the application. It requires Bun 1.4.0 or newer and access to the `@kar-mi/spirit-vale-tools-*` GitHub Packages.

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

### Capture diagnostics

For a short reproduction of a packet-capture or map-transition issue, launch the app from PowerShell
with diagnostic logging enabled:

```powershell
$env:SPIRIT_VALE_DIAGNOSTIC_LOGS = "1"
bun run dev
```

The resulting session includes `other.jsonl` alongside `combat.jsonl`. Around each authenticated game
connection it records five seconds of buffered LiteNet traffic and ten seconds after authentication,
plus connection-admission decisions and status-RPC decoder input/output. Raw transition traffic is
bounded to 8 MiB before and 32 MiB after authentication; a `capture.diagnosticLimit` record reports
truncation. Diagnostic logs contain raw game-network payloads and endpoint addresses, so review them
before sharing and disable the environment variable after reproducing the issue.

## Support

Ask for help in the [Spirit Vale Overlay Discord](https://discord.gg/XtZbkspzpZ), or open a
[GitHub issue](https://github.com/kar-mi/spirit-vale-overlay/issues) for a reproducible bug.

## VPN Issues

Using a VPN or network optimizer such as ExitLag can prevent packet capture.
See [VPN Issues](docs/vpn/VPN_ISSUES.md) for known tools and fixes.

## Releases

See [RELEASE.md](RELEASE.md) for GitHub setup and Windows release instructions.
