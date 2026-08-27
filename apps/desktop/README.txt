Spirit Vale Overlay

Extract the complete ZIP, then run "spirit-vale-overlay-win_x64.exe" on Windows x64.
Npcap is required. Install it in WinPcap API-compatible mode without restricting it to administrators.

Portable data stays in this folder:
- Settings: data\settings\
- Logs: data\logs\
- Runtime, browser, and temporary data: data\runtime\

The portable marker keeps these files out of Windows AppData.

To use Windows AppData instead:
1. Close Spirit Vale Overlay completely.
2. Delete .spirit-vale-portable from this folder.
3. Restart the app. New data will be stored under %APPDATA%\Spirit Vale Overlay\data\.

Deleting the marker does not move existing portable data. Export settings from
Settings > Manage Settings before deleting it, then import them after restarting.
You can also import from this folder's data directory after switching.

This release supports Windows x64 only.
