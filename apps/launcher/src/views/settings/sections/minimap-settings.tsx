import { useEffect, useState } from "preact/hooks";
import { RARITY_TIERS } from "@svoverlay/overlay/rarity";
import type { SettingsSection, SettingsSectionContext } from "../settings-section.ts";

function LootChanceNumberInput({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const [text, setText] = useState(() => String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  return (
    <input
      class="input settings-number"
      type="number"
      min="0"
      max="100"
      step="0.01"
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); setText(String(value)); }}
      onInput={(event) => {
        const next = event.currentTarget.value;
        setText(next);
        const parsed = Number.parseFloat(next);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
    />
  );
}

export function buildMinimapSettingsSection({ state, busy, actions }: SettingsSectionContext): SettingsSection {
  const { minimapEnabled, minimapRarityFilter, minimapLootChanceFilter } = state.overlay;
  return {
    id: "minimap",
    label: "Minimap",
    description: "Turn the minimap on or off, and set the loot thresholds it shares with loot notifications.",
    items: [
      {
        id: "minimap-enabled",
        searchText: "Minimap enable disable off on turn feature radar tab keybind",
        content: <>
          <label class="settings-check">
            <input
              type="checkbox"
              checked={minimapEnabled}
              disabled={busy}
              onChange={(event) => actions.setMinimapEnabled(event.currentTarget.checked)}
            />
            <span>Enable the minimap</span>
          </label>
          <ul class="settings-hint settings-hint-list">
            <li>Off hides the minimap completely — the show/hide keybind does nothing, and its row in Overlay &gt; Visible elements is inactive.</li>
            <li>On shows the tile; the keybind hides and shows it from there.</li>
          </ul>
        </>,
      },
      {
        id: "minimap-rarity-filter",
        searchText: "Minimap rarity filter loot threshold minimum maximum drop chance shared radar notification toast",
        content: <div class="settings-card">
          <label class="settings-field">
            <span>Minimum loot rarity</span>
            <div class="settings-tier-group" role="radiogroup">
              {RARITY_TIERS.map((tier) => (
                <label key={tier.value} class="settings-tier-option" data-selected={tier.value === minimapRarityFilter}>
                  <input
                    type="radio"
                    name="minimap-rarity-filter"
                    checked={tier.value === minimapRarityFilter}
                    disabled={busy}
                    onChange={() => actions.setMinimapRarityFilter(tier.value)}
                  />
                  <span class="settings-tier-swatch" style={{ backgroundColor: tier.color }} />
                  <span>{tier.label}</span>
                </label>
              ))}
            </div>
          </label>
          <p class="settings-hint">A minimum: Rare keeps Rare and Epic.</p>
          <label class="settings-field">
            <span class="settings-row">
              <span>Maximum drop chance (%)</span>
              <LootChanceNumberInput value={minimapLootChanceFilter} onChange={actions.setMinimapLootChanceFilter} />
            </span>
            <input
              class="settings-slider"
              type="range"
              min="0"
              max="100"
              step="0.01"
              value={minimapLootChanceFilter}
              onInput={(event) => actions.setMinimapLootChanceFilter(event.currentTarget.valueAsNumber)}
            />
          </label>
          <p class="settings-hint">A maximum: loot that drops more often than this is hidden.</p>
          <p class="settings-hint">Both filters also apply to Loot notifications, which stay active while the minimap is off.</p>
        </div>,
      },
    ],
  };
}
