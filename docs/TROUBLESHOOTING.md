# Troubleshooting Spirit Vale Overlay on Windows

This guide covers the portable Windows x64 release of Spirit Vale Overlay. Work through the sections that match the symptom you see.

## Quick recovery checklist

1. Confirm that the computer is running 64-bit Windows 10 version 1809 or newer, or Windows 11.
2. Install or repair the required components:
   - [Npcap](https://npcap.com/#download). During setup, select **Install Npcap in WinPcap API-compatible Mode** and leave **Restrict Npcap driver's access to Administrators only** unchecked.
   - [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/). Use the **Evergreen Bootstrapper**, or the x64 **Evergreen Standalone Installer** for an offline installation. Neutralino uses WebView2 to display the app on Windows.
   - [Microsoft Visual C++ Redistributable for x64](https://aka.ms/vc14/vc_redist.x64.exe). Choose **Repair** if it is already installed.
3. Restart Windows after installing or repairing Npcap or the runtimes.
4. Download the latest ZIP from [GitHub Releases](https://github.com/kar-mi/spirit-vale-overlay/releases/latest).
5. If you are unable to extract the zip, right-click it, choose **Properties**, select **Unblock** if that option is present, and then extract it. You can scan the zip with antivirus/view as needed.
6. Extract the entire ZIP to a normal writable local folder, such as `C:\Users\<you>\Games\SpiritValeOverlay`. Do not run the executable from inside the ZIP. Avoid protected folders such as `C:\Program Files`, network drives, and cloud-synced folders while troubleshooting.
7. Run `spirit-vale-overlay-win_x64.exe` from the extracted folder.

The portable release already includes the Bun runtime it needs at `extensions\bin\bun.exe`. End users do not need to install Bun separately.

## The app does not open or immediately closes

### Re-extract a clean copy

An incomplete extraction or a security product removing one file can prevent startup.

1. Close every Spirit Vale Overlay window.
2. In Task Manager, end any remaining `spirit-vale-overlay-win_x64.exe` or `bun.exe` process that belongs to the extracted app folder.
3. Keep the old folder temporarily if it contains settings you need.
4. Download the release ZIP again and extract it to a new folder.
5. Confirm that the new folder contains at least:
   - `spirit-vale-overlay-win_x64.exe`
   - `resources.neu`
   - `extensions\backend\index.js`
   - `extensions\bin\bun.exe`
6. Start the executable from the new folder.

Do not copy only the main `.exe`; the app requires the other files in the release folder.

### Check Windows Security

Open **Windows Security > Virus & threat protection > Protection history** and look for an action involving the Spirit Vale executable, `extensions\bin\bun.exe`, or another file in the extracted folder.

If Windows Security removed a file, first confirm that the ZIP came from the official GitHub Releases page. Restore or allow the file only if you trust that download, then extract a fresh copy. Prefer allowing the specific detected file or app over disabling antivirus protection or excluding a broad folder. If the warning remains, include its exact detection name and affected path in a bug report.

If Windows shows a SmartScreen prompt, use **More info** to inspect the publisher and file name before deciding whether to run it.

### Test the bundled backend

From PowerShell in the extracted application folder, run:

```powershell
& ".\extensions\bin\bun.exe" --version
```

It should print a version number and exit. If the file is missing, blocked, or will not start, re-extract the ZIP and check Windows Security. Installing a separate global copy of Bun does not replace the bundled runtime used by the app.

### Try elevated permissions as a diagnostic

Right-click `spirit-vale-overlay-win_x64.exe` and choose **Run as administrator** once. Running the overlay as administrator is only required if **Restrict Npcap driver's access to Administrators only** is unchecked during the main install.

## The window is blank or never finishes loading

1. Install or repair the [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/), then restart Windows.
2. Close all leftover Spirit Vale Overlay and bundled `bun.exe` processes before trying again.
3. Reset only the WebView/runtime state as described below.
4. Make sure security software is not blocking local loopback traffic. Neutralino and the backend communicate on `127.0.0.1` using temporary local ports.

## Reset settings or cached runtime data

Close the app before changing its data. If possible, export settings first from **Settings > Manage Settings**.

The default portable release stores data beside the executable:

- Settings: `data\settings\`
- Logs: `data\logs\`
- WebView, runtime, and temporary state: `data\runtime\`

To test whether cached runtime state is corrupt, rename `data\runtime` to `data\runtime.old` and restart the app. If that does not help, restore the old folder or delete the newly created replacement.

To test with entirely fresh portable data, rename `data` to `data.old` and restart. This resets settings as well as cached state, but the renamed folder remains available for recovery.

If `.spirit-vale-portable` has been removed from the application folder, the app instead creates new data under:

```text
%APPDATA%\Spirit Vale Overlay\data
```

Deleting `.spirit-vale-portable` changes the location used on the next start; it does not move existing data automatically.

## The app opens but capture or DPS does not work

### Verify Npcap

1. Re-run the [Npcap installer](https://npcap.com/#download).
2. Select **Install Npcap in WinPcap API-compatible Mode**.
3. Leave **Restrict Npcap driver's access to Administrators only** unchecked. (You can leave this checked, but will need to ensure the overlay then runs in admin mode)
4. Restart Windows.
5. Start Spirit Vale Overlay before reproducing the problem.

Spirit Vale Overlay captures passively and does not send, modify, drop, or inject game traffic. Other players' observed DPS can fall when they move outside capture range.

### Check VPNs and network optimizers

VPNs and tools such as ExitLag may move game traffic to an adapter that Npcap is not capturing. Temporarily disable the VPN or optimizer as a test, or follow the known fixes in [VPN Issues](vpn/VPN_ISSUES.md).

If the computer has several network adapters, confirm that the game and the overlay are using the expected active connection. Virtual-machine, VPN, and tunnel adapters are common sources of capture problems.

### Check the firewall

Allow Spirit Vale Overlay on **Private networks** if Windows Firewall prompts. The app's frontend and bundled backend communicate locally on `127.0.0.1`; do not expose or forward its temporary ports to the internet. Public-network access should not normally be necessary.

## The overlay is missing, frozen, or misplaced

- Press `Ctrl+Shift+4` to show or hide the overlay.
- Press `Ctrl+Shift+1` to unlock it, then drag tiles back into view.
- Check **Settings > Keybinds** in case the defaults were changed or conflict with another application.
- Close utilities that also draw overlays or register global hotkeys, then retest. This includes capture tools, GPU overlays, macro tools, and some accessibility utilities.
- If monitors were added, removed, rearranged, or had their display scaling changed, reset the overlay layout in Settings or test with fresh settings.
- Run the game in borderless-windowed mode as a diagnostic if the overlay is not visible over exclusive fullscreen.

## Logs and information to include in a bug report

Reproduce the problem once, close the app, and collect the newest relevant files.

For the portable configuration, check:

```text
<extracted folder>\neutralinojs.log
<extracted folder>\neutralino-backend.log
<extracted folder>\data\logs\
```

For AppData mode, also check:

```text
%APPDATA%\Spirit Vale Overlay\data\logs\
```

Include:

- The Spirit Vale Overlay version and Windows version.
- What happened, what you expected, and exact reproduction steps.
- Whether the app opens, whether the launcher works, and whether only packet capture fails.
- The newest Neutralino and backend logs.
- Any Windows Security detection name or Windows Event Viewer error.
- Whether Npcap, a VPN/network optimizer, or another overlay is installed.

Review logs before sharing them. Diagnostic logs may contain endpoint addresses and raw game-network payloads.

## Developer-only checks

These steps apply only when running from source. The portable release does not require a system Bun installation.

The repository requires Bun 1.4.0 or newer. Verify the active installation with:

```powershell
bun --version
bun --revision
```

Then, from the repository root:

```powershell
bun install
bun run check
bun run dev
```

If Neutralino's pinned binaries have not been downloaded yet:

```powershell
bun run --filter @svoverlay/desktop update
```

To capture additional packet and transition diagnostics during a short reproduction:

```powershell
$env:SPIRIT_VALE_DIAGNOSTIC_LOGS = "1"
bun run dev
```

Disable the environment variable afterward. These diagnostic logs can contain raw network payloads and endpoint addresses.
