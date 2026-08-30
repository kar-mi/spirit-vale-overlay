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

export function buildMinimapSettingsSection({ state, busy, actions, t }: SettingsSectionContext): SettingsSection {
  const { minimapEnabled, minimapRarityFilter, minimapLootChanceFilter } = state.overlay;
  return {
    id: "minimap",
    label: t("settings.minimap.label"),
    description: t("settings.minimap.description"),
    items: [
      {
        id: "minimap-enabled",
        searchText: t("settings.minimap.enabled.search"),
        content: <>
          <label class="settings-check">
            <input
              type="checkbox"
              checked={minimapEnabled}
              disabled={busy}
              onChange={(event) => actions.setMinimapEnabled(event.currentTarget.checked)}
            />
            <span>{t("settings.minimap.enabled.label")}</span>
          </label>
          <ul class="settings-hint settings-hint-list">
            <li>{t("settings.minimap.enabled.hintOff")}</li>
            <li>{t("settings.minimap.enabled.hintOn")}</li>
          </ul>
        </>,
      },
      {
        id: "minimap-rarity-filter",
        searchText: t("settings.minimap.filters.search"),
        content: <div class="settings-card">
          <label class="settings-field">
            <span>{t("settings.minimap.rarity.label")}</span>
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
          <p class="settings-hint">{t("settings.minimap.rarity.hint")}</p>
          <label class="settings-field">
            <span class="settings-row">
              <span>{t("settings.minimap.lootChance.label")}</span>
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
          <p class="settings-hint">{t("settings.minimap.lootChance.hint")}</p>
          <p class="settings-hint">{t("settings.minimap.filters.hintShared")}</p>
        </div>,
      },
    ],
  };
}
