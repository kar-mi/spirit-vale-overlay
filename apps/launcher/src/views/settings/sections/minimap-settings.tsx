import { RARITY_TIERS } from "@svoverlay/overlay/rarity";
import type { SettingsSection, SettingsSectionContext } from "../settings-section.ts";

export function buildMinimapSettingsSection({ state, busy, actions }: SettingsSectionContext): SettingsSection {
  const { minimapRarityFilter, minimapLootChanceFilter } = state.overlay;
  return {
    id: "minimap",
    label: "Minimap",
    description: "Loot rarity and drop-chance thresholds shared by the minimap tile and loot notifications.",
    items: [
      {
        id: "minimap-rarity-filter",
        searchText: "Minimap rarity filter loot threshold radar notification toast",
        content: <div class="settings-card">
          <label class="settings-field">
            <span>Loot rarity filter</span>
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
          <label class="settings-field">
            <span class="settings-row">
              <span>Loot drop-chance filter (≤ X%)</span>
              <input
                class="settings-number"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={minimapLootChanceFilter}
                onInput={(event) => {
                  const next = event.currentTarget.valueAsNumber;
                  if (Number.isFinite(next)) actions.setMinimapLootChanceFilter(next);
                }}
              />
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
          <p class="settings-hint">Only ground loot at or above the rarity filter and at or below the drop-chance filter is shown on the minimap tile or raises a loot notification. The minimap and loot notification tiles are enabled and positioned like any other overlay element, in Overlay &gt; Visible elements.</p>
        </div>,
      },
    ],
  };
}
