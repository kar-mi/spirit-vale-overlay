# Installation

## Pre-install

Before installing Spirit Vale Overlay, download and install Npcap from
[npcap.com/#download](https://npcap.com/#download). Select **Install Npcap in
WinPcap API-compatible Mode** and leave **Restrict Npcap driver's access to
Administrators only** unchecked.

![Required Npcap installation options](img/npcap_option.png)

## Portable release

1. Download the latest `spirit-vale-overlay-windows-x64-v*.zip` from [GitHub Releases](https://github.com/kar-mi/spirit-vale-overlay/releases/latest).
2. Extract the complete ZIP. It contains one versioned folder, such as `spirit-vale-overlay-windows-x64-v0.10.5`.
3. Open that folder and run `spirit-vale-overlay-win_x64.exe`.

The portable app supports Windows x64 and, by default, keeps its settings, logs, and writable runtime data inside the extracted folder.

To store data in Windows AppData instead:

1. Close Spirit Vale Overlay completely.
2. Delete `.spirit-vale-portable` from the extracted application folder.
3. Restart the app. New data will be stored under `%APPDATA%\Spirit Vale Overlay\data`.

Deleting the marker does not move existing portable data. To keep your current settings, open **Settings > Manage Settings** before deleting it and export them, then import them after restarting. You can also import directly from the old extracted folder's `data` directory.

If the app does not start, shows a blank window, or cannot capture game traffic, see the [Windows troubleshooting guide](TROUBLESHOOTING.md).