# 2BITTER's Spirit Vale Overlay Fork

This is a personal fork of [kar-mi/spirit-vale-overlay](https://github.com/kar-mi/spirit-vale-overlay) — full
credit to **kar-mi** for building and maintaining the original Spirit Vale companion app. Everything below the
divider is kar-mi's own README for the base project, unchanged; this section only covers what this fork adds
on top of it.

## What this fork adds

UI/QoL customization for the in-game overlay:

- **Anchor system** — link one element to another (e.g. pin the MP bar directly under the HP bar) so moving
  the parent carries the child with it, while the child can still be moved independently when unlinked.
  Scoped to elements on the same monitor.
- **Snap-to-edge** — a toggleable "Snap" mode that aligns an element's edges/centers to nearby elements while
  dragging, for precise placement without needing to anchor.
- **Element inspector panel** — a single, draggable panel that shows an element's settings (opacity, anchor,
  growth direction, color, visibility) when you click it, replacing the old per-element popups that
  overlapped once elements sat close together.
- **Status grid growth direction** — buffs/debuffs/toggles can grow right/left/down/up instead of only the
  fixed left-to-right layout.
- **Per-element bar color** — a color picker for the HP/MP/Character XP/Job XP bars' fill color, with a
  one-click reset back to default.
- **Redesigned resize handles** — thin corner brackets shown only on the currently-selected element, instead
  of larger dots that obscured the corner they sat on and made lining elements up harder.
- **Auto-hide when unfocused** — an optional toggle that hides the overlay when neither the game nor the app
  has focus (e.g. tabbing to File Explorer or a browser), so it stops sitting on top of unrelated windows. A
  manual show/hide always takes priority over the automatic behavior.

Branch: [`feature/auto-hide-and-inspector-panel`](https://github.com/2BITTER/spirit-vale-overlay/tree/feature/auto-hide-and-inspector-panel)

---

# Spirit Vale Overlay

Spirit Vale Overlay is a passive Windows companion app for live combat, character, reward, and in-game overlay information. It uses your existing Npcap installation in non-promiscuous mode and never sends, modifies, drops, or injects game traffic. Disclaimer for packet capture dps tools, packet capture is based on proxmity, so dps for other players will go down when out of range.

**[Jump to Installation ↓](#installation)**

> Looking for the pacakges to use for development? See
> [spirit-vale-tools](https://github.com/kar-mi/spirit-vale-tools).

> **Overlay hotkeys:** `F5` resets/refreshes the overlay, `F6` opens the live death log, `F9` shows or hides
> the overlay, `F7` cycles the party meter, and `F11` unlocks the overlay for editing (drag and resize
> elements, then press `F11` again to lock. These can re-bound). Hotkeys pass through to the foreground
> program, so its normal action for the same key still runs.

## Features

The launcher gives you quick access to combat DPS, rewards, and character
tools. The shared Settings window contains general, network, overlay, and keybind
configuration.

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

Before installing Spirit Vale Overlay, download and install Npcap from
[npcap.com/#download](https://npcap.com/#download). Select **Install Npcap in
WinPcap API-compatible Mode** and leave **Restrict Npcap driver's access to
Administrators only** unchecked.

![Required Npcap installation options](docs/img/npcap_option.png)

### Portable release

1. Download the latest `Spirit-Vale-Overlay-portable-win-x64-v*.zip` from [GitHub Releases](https://github.com/kar-mi/spirit-vale-overlay/releases/latest).
2. Extract the complete ZIP.
3. Run the top-level `Spirit Vale Overlay.lnk` shortcut.

The portable app keeps its settings, logs, and writable runtime data inside the extracted folder.

### Run from source

This path is only for developers building the application. It requires Bun 1.3.14 or newer and access to the `@kar-mi/spirit-vale-tools-*` GitHub Packages.

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

## VPN Issues
![Potential solutions to vpn issues](VPN_ISSUES.md)

## Releases

See [RELEASE.md](RELEASE.md) for GitHub setup and Windows release instructions.
