import { CheckboxMultiSelect } from "@svoverlay/ui-kit/checkbox-multi-select";
import type { RequiredStatusCategory } from "@svoverlay/overlay/app-types";
import { REQUIRED_STATUS_CATEGORIES, requiredStatusOptions } from "@svoverlay/overlay/required-statuses";
import type { MessageKey } from "@svoverlay/i18n/messages";
import type { SettingsSection, SettingsSectionContext } from "../settings-section.ts";

const REQUIRED_STATUS_LABEL_KEYS: Record<RequiredStatusCategory, MessageKey> = {
  buffs: "settings.status.category.buffs",
  toggles: "settings.status.category.toggles",
};
const WARN_WHEN_MISSING_KEYS: Record<RequiredStatusCategory, MessageKey> = {
  buffs: "settings.status.warnWhenMissing.buffs",
  toggles: "settings.status.warnWhenMissing.toggles",
};
const REQUIRED_STATUS_OPTIONS = Object.fromEntries(REQUIRED_STATUS_CATEGORIES.map((category) => [
  category,
  requiredStatusOptions(category).map((option) => ({
    value: option.statusId,
    label: option.displayName,
    iconSrc: `views://assets/status-icons/${option.spriteId}.webp`,
  })),
])) as Record<RequiredStatusCategory, { value: string; label: string; iconSrc: string }[]>;

export function buildStatusSettingsSection({ state, actions, t }: SettingsSectionContext): SettingsSection {
  const { overlay } = state;
  return {
    id: "status",
    label: t("settings.status.label"),
    description: t("settings.status.description"),
    items: [{
      id: "missing-buff-warning",
      searchText: t("settings.status.missingBuff.search"),
      content: <><div class="settings-card"><h2>{t("settings.status.missingBuff.label")}</h2>{REQUIRED_STATUS_CATEGORIES.map((category) => {
        const armed = new Set(overlay.requiredStatuses[category]);
        const setArmed = (statusIds: string[]): void => actions.setRequiredStatuses(category, statusIds);
        const categoryLabel = t(REQUIRED_STATUS_LABEL_KEYS[category]);
        return <div class="settings-field" key={category}>
          <span>{categoryLabel}</span>
          <CheckboxMultiSelect
            options={REQUIRED_STATUS_OPTIONS[category]}
            selected={armed}
            onChange={(selected) => setArmed([...selected])}
            ariaLabel={t(WARN_WHEN_MISSING_KEYS[category])}
            searchPlaceholder={t("settings.status.searchPlaceholder")}
            clearLabel={t("settings.status.clear")}
            noMatchLabel={(query) => t("settings.status.noMatch", { query })}
            summarize={(chosen) => chosen.size === 0 ? t("settings.status.summarizeEmpty") : t("settings.status.summarizeCount", { count: chosen.size })}
          />
          {armed.size > 0 && <ul class="status-chips">{REQUIRED_STATUS_OPTIONS[category].filter((option) => armed.has(option.value)).map((option) =>
            <li class="status-chip" key={option.value}>
              <img src={option.iconSrc} alt="" aria-hidden="true" />
              <span>{option.label}</span>
              <button type="button" class="status-chip-remove" aria-label={t("settings.status.stopWarning", { name: option.label })} onClick={() => setArmed([...armed].filter((statusId) => statusId !== option.value))}>×</button>
            </li>)}</ul>}
        </div>;
      })}<p class="settings-hint">{t("settings.status.hint.outline")}</p></div><p class="settings-hint">{t("settings.status.hint.tilesEnabled")}</p></>,
    }],
  };
}
