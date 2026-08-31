---
title: Installation
permalink: /install/
description: >-
  Download and install the portable Windows x64 build of Spirit Vale Overlay,
  including the required Npcap setup and portable data options.
---

Spirit Vale Overlay ships as a portable Windows x64 app. There is no installer:
you install Npcap once, then extract a ZIP and run the executable.

{% include download.html %}

## Requirements

- 64-bit Windows 10 version 1809 or newer, or Windows 11.
- [Npcap](https://npcap.com/#download) — see the pre-install step below.
- [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/),
  already present on most up-to-date Windows installations.

The portable release bundles everything else it needs, including its Bun
runtime. There is nothing else to install.

## Pre-install

Before installing Spirit Vale Overlay, download and install Npcap from
[npcap.com/#download](https://npcap.com/#download). Select **Install Npcap in
WinPcap API-compatible Mode** and leave **Restrict Npcap driver's access to
Administrators only** unchecked.

![Required Npcap installation options](../img/npcap_option.png)

## Portable release

1. Download the latest `spirit-vale-overlay-windows-x64-v*.zip` from [GitHub Releases](https://github.com/kar-mi/spirit-vale-overlay/releases/latest).
2. Extract the complete ZIP. It contains one versioned folder, such as `spirit-vale-overlay-windows-x64-v0.10.6`.
3. Open that folder and run `spirit-vale-overlay-win_x64.exe`.

The portable app supports Windows x64 and, by default, keeps its settings, logs, and writable runtime data inside the extracted folder.

## Where your data is stored

To store data in Windows AppData instead:

1. Close Spirit Vale Overlay completely.
2. Delete `.spirit-vale-portable` from the extracted application folder.
3. Restart the app. New data will be stored under `%APPDATA%\Spirit Vale Overlay\data`.

Deleting the marker does not move existing portable data. To keep your current settings, open **Settings > Manage Settings** before deleting it and export them, then import them after restarting. You can also import directly from the old extracted folder's `data` directory.

## If something goes wrong

If the app does not start, shows a blank window, or cannot capture game traffic, see the [Windows troubleshooting guide](../TROUBLESHOOTING.md). Using a VPN or network optimizer such as ExitLag needs [extra configuration](../vpn/VPN_ISSUES.md).

You can also ask for help in the [Spirit Vale Overlay Discord](https://discord.gg/XtZbkspzpZ).
