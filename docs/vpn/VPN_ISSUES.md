---
title: VPN and network optimizer issues
permalink: /vpn/
description: >-
  Known VPN and network-optimizer settings, including ExitLag, that stop Spirit
  Vale Overlay from capturing game traffic.
---

Some VPN and network-optimization tools change how game packets reach your
machine, which can stop Spirit Vale Overlay from capturing traffic.

## ExitLag

ExitLag recently updated their settings, which changed how they redirect
packets. If the overlay shows no combat data while ExitLag is active, open
ExitLag's settings and apply the following:

- **Optimization options > Use dual routes** — off
- **Optimization options > IP version for route analysis** — `IPv4`
- **Advanced options > Redirection method** — `NDIS (legacy)`

Then restart your connection and the game.

![ExitLag settings with dual routes off, IPv4 route analysis, and NDIS (legacy) redirection](exit_lag_settings.png)
