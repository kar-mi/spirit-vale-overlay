import { CustomSelect } from "@svoverlay/ui-kit/custom-select";
import { LOCALE_OPTIONS, type LocaleCode } from "@svoverlay/i18n/locale";
import type { SettingsSection, SettingsSectionContext } from "../settings-section.ts";

export function buildLanguageSettingsSection({ state, busy, actions, t }: SettingsSectionContext): SettingsSection {
  return {
    id: "language",
    label: t("settings.language.label"),
    description: t("settings.language.description"),
    items: [
      {
        id: "display-language",
        searchText: t("settings.language.select.search"),
        content: <>
          <label class="settings-field">
            <span>{t("settings.language.select.label")}</span>
            {/* Locale names stay in their own language, so they read to someone who cannot read the current one. */}
            <CustomSelect
              ariaLabel={t("settings.language.select.label")}
              disabled={busy}
              value={state.launcher.language}
              options={LOCALE_OPTIONS}
              onChange={(value) => actions.setLanguage(value as LocaleCode)}
            />
          </label>
          <p class="settings-hint">{t("settings.language.hint")}</p>
        </>,
      },
    ],
  };
}
