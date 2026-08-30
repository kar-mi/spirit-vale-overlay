---
title: Features
permalink: /
hero: true
hero_title: Spirit Vale Overlay
hero_lede: >-
  A passive Windows companion app for live combat, character, reward, and
  in-game overlay information. It reads traffic through your existing Npcap
  installation in non-promiscuous mode and never sends, modifies, drops, or
  injects game traffic.
description: >-
  Live party DPS, combat logs, death breakdowns, and reward tracking for
  Windows, in a portable overlay that never touches your game traffic.
---

## Launcher and settings

The launcher gives you quick access to combat DPS, rewards, and character tools.
The shared Settings window holds general, network, overlay, and keybind
configuration.

![Launcher window](img/launcher_window.png)

## Live overlay

The in-game overlay shows live party DPS along with HP/MP during combat. Press
`Ctrl+Shift+4` to show or hide it, and `Ctrl+Shift+1` to unlock it and drag
elements into the layout you want.

![In-game DPS overlay](img/dps_overlay.png)

![Editing the overlay layout](img/edit_overlay.png)

## Combat and death logs

Combat logs break down per-player damage, DPS, crit rate, and kills, and the
death log shows the hits taken in the seconds before a death.

![Combat log analysis](img/combat_logs.png)

![Death log](img/death_log.png)

Because capture is proximity-based, DPS reported for other players drops when
they move out of capture range.

## Default hotkeys

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+1` | Lock or unlock the overlay |
| `Ctrl+Shift+2` | Reset the session |
| `Ctrl+Shift+3` | Open the live death log |
| `Ctrl+Shift+4` | Show or hide the overlay |
| `Ctrl+Shift+5` | Cycle the party meter |
| `Ctrl+Shift+6` / `Ctrl+Shift+7` | Reset all-time XP / gold |
| `Ctrl+Shift+8` | Cycle the boss timer tile between regions |

All of these can be rebound in **Settings > Keybinds**. Hotkeys pass through to
the foreground program, so its normal action for the same combination still
runs. Windows may also use Ctrl+Shift to switch input languages when configured
that way.

## Get started

Spirit Vale Overlay is a portable Windows x64 app. It needs
[Npcap](https://npcap.com/#download) installed first, and nothing else — the
release bundles its own runtime.

[Read the installation guide](install/index.md)

## Support

Stuck or seeing something unexpected?

- Work through the [Windows troubleshooting guide](TROUBLESHOOTING.md) first — it covers startup failures, blank windows, capture problems, and [VPN or network optimizer conflicts](vpn/VPN_ISSUES.md).
- Ask in the [Spirit Vale Overlay Discord](https://discord.gg/XtZbkspzpZ) if you are still stuck or want a hand reading your logs.
- File a reproducible bug at [GitHub Issues](https://github.com/kar-mi/spirit-vale-overlay/issues).
