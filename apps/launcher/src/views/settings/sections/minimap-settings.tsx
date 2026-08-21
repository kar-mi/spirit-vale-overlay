import { useEffect, useState } from "preact/hooks";
import { RARITY_TIERS } from "@svoverlay/overlay/rarity";
import type { SettingsSection, SettingsSectionContext } from "../settings-section.ts";

/**
 * A number input bound to `minimapLootChanceFilter` would otherwise fight the user: every keystroke
 * round-trips through the server, and re-rendering with the committed value (e.g. `5`) strips a
 * trailing "." the user just typed before they can enter the fractional part. Keeping the typed text
 * in local state — only resynced from the committed value while the field isn't focused — lets
 * intermediate strings like "5." or "5.0" survive until the user is done editing.
 */
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
          <p class="settings-hint">Only ground loot at or above the rarity filter and at or below the drop-chance filter is shown on the minimap tile or raises a loot notification. The minimap and loot notification tiles are enabled and positioned like any other overlay element, in Overlay &gt; Visible elements.</p>
        </div>,
      },
    ],
  };
}
