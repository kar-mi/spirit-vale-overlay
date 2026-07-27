# Spirit Vale

Spirit Vale is a passive Windows companion app for live combat, character, reward, market, and in-game overlay information. It uses your existing Npcap installation in non-promiscuous mode and never sends, modifies, drops, or injects game traffic.

> Looking for the pacakges to use for development? See
> [spirit-vale-tools](https://github.com/kar-mi/spirit-vale-tools).

## Installation

### Portable release

1. Download the latest `Spirit-Vale-portable-win-x64-v*.zip` from [GitHub Releases](https://github.com/kar-mi/spirit-vale-overlay/releases/latest).
2. Extract the complete ZIP.
3. Run the top-level `Spirit Vale.exe`.

Npcap is installed separately. Select **Install Npcap in WinPcap API-compatible Mode** and leave **Restrict Npcap driver's access to Administrators only** unchecked. The portable app keeps its settings, logs, and writable runtime data inside the extracted folder.

![Required Npcap installation options](docs/img/npcap_option.png)

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
