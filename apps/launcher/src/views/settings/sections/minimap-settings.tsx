import { MINIMAP_RARITY_MAX, MINIMAP_RARITY_MIN } from "@svoverlay/overlay/minimap-settings";
import type { SettingsSection, SettingsSectionContext } from "../settings-section.ts";

export function buildMinimapSettingsSection({ state, busy, actions }: SettingsSectionContext): SettingsSection {
  const { minimapRarityFilter, minimapEnabled } = state;
  return {
    id: "minimap",
    label: "Minimap",
    description: "A separate radar window showing your position and nearby ground loot, toggled with its own keybind.",
    items: [
      {
        id: "minimap-enabled",
        searchText: "Minimap enable disable turn off lag performance",
        content: <><label class="settings-check"><input type="checkbox" checked={minimapEnabled} disabled={busy} onChange={(event) => actions.setMinimapEnabled(event.currentTarget.checked)} /><span>Enable minimap</span></label><p class="settings-hint">Turns off position/loot tracking and the minimap window entirely. Disable this if you're experiencing lag.</p></>,
      },
      ...(minimapEnabled ? [{
        id: "minimap-rarity-filter",
        searchText: "Minimap rarity filter loot threshold radar",
        content: <div class="settings-card">
          <label class="settings-field">
            <span>Loot rarity filter</span>
            <div class="settings-row">
              <input
                class="settings-slider"
                type="range"
                min={MINIMAP_RARITY_MIN}
                max={MINIMAP_RARITY_MAX}
                step={1}
                value={minimapRarityFilter}
                onInput={(event) => actions.setMinimapRarityFilter(event.currentTarget.valueAsNumber)}
              />
              <output>{minimapRarityFilter}</output>
            </div>
          </label>
          <p class="settings-hint">Only ground loot at or above this rarity is shown on the minimap. The keybind to show/hide the minimap is configured in Keybinds.</p>
        </div>,
      }] : []),
    ],
  };
}
