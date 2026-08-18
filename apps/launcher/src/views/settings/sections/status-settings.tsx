import { CheckboxMultiSelect } from "@svoverlay/ui-kit/checkbox-multi-select";
import type { RequiredStatusCategory } from "@svoverlay/overlay/app-types";
import { REQUIRED_STATUS_CATEGORIES, requiredStatusOptions } from "@svoverlay/overlay/required-statuses";
import type { SettingsSection, SettingsSectionContext } from "../settings-section.ts";

const REQUIRED_STATUS_LABELS: Record<RequiredStatusCategory, string> = { buffs: "Buffs", toggles: "Toggles" };
/** Status sprites are copied into a single shared assets folder for every view. */
const REQUIRED_STATUS_OPTIONS = Object.fromEntries(REQUIRED_STATUS_CATEGORIES.map((category) => [
  category,
  requiredStatusOptions(category).map((option) => ({
    value: option.statusId,
    label: option.displayName,
    iconSrc: `views://assets/status-icons/${option.spriteId}.webp`,
  })),
])) as Record<RequiredStatusCategory, { value: string; label: string; iconSrc: string }[]>;

export function buildStatusSettingsSection({ state, actions }: SettingsSectionContext): SettingsSection {
  const { overlay } = state;
  return {
    id: "status",
    label: "Status",
    description: "Warn when the buffs you rely on drop off.",
    items: [{
      id: "missing-buff-warning",
      searchText: "Missing buff warning required statuses buffs toggles selection red outline tiles",
      content: <><div class="settings-card"><h2>Missing buff warning</h2>{REQUIRED_STATUS_CATEGORIES.map((category) => {
        const armed = new Set(overlay.requiredStatuses[category]);
        const setArmed = (statusIds: string[]): void => actions.setRequiredStatuses(category, statusIds);
        return <div class="settings-field" key={category}>
          <span>{REQUIRED_STATUS_LABELS[category]}</span>
          <CheckboxMultiSelect
            options={REQUIRED_STATUS_OPTIONS[category]}
            selected={armed}
            onChange={(selected) => setArmed([...selected])}
            ariaLabel={`Warn when these ${REQUIRED_STATUS_LABELS[category].toLowerCase()} are missing`}
            searchPlaceholder="Search buffs"
            clearLabel="Clear selection"
            noMatchLabel={(query) => `No buffs match "${query}".`}
            summarize={(chosen) => chosen.size === 0 ? "Select buffs…" : `${chosen.size} selected`}
          />
          {armed.size > 0 && <ul class="status-chips">{REQUIRED_STATUS_OPTIONS[category].filter((option) => armed.has(option.value)).map((option) =>
            <li class="status-chip" key={option.value}>
              <img src={option.iconSrc} alt="" aria-hidden="true" />
              <span>{option.label}</span>
              <button type="button" class="status-chip-remove" aria-label={`Stop warning when ${option.label} is missing`} onClick={() => setArmed([...armed].filter((statusId) => statusId !== option.value))}>×</button>
            </li>)}</ul>}
        </div>;
      })}<p class="settings-hint">Selected buffs that aren't active outline the matching overlay tile in red.</p></div><p class="settings-hint">The Buffs and Toggles tiles must be enabled under Overlay for the warning to be visible.</p></>,
    }],
  };
}
