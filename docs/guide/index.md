---
title: Guide
permalink: /guide/
description: >-
  How each part of Spirit Vale Overlay works — the in-game overlay, combat
  logs, boss timers, character data, rewards, build export, and settings.
---

{% include guide-nav.html %}

Spirit Vale Overlay opens from the launcher into a set of focused tools. Each
page below walks through one of them with screenshots.

<ul class="guide-cards">
  {% for item in site.guide_nav %}
    <li>
      <a href="{{ item.url | relative_url }}">
        <strong>{{ item.title }}</strong>
        <span>{{ item.blurb }}</span>
      </a>
    </li>
  {% endfor %}
</ul>

New here? Start with the [installation guide](../install/index.md), then come
back for the overlay and combat pages.
