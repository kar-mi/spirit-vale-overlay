import { useTranslator } from "@svoverlay/i18n/browser";

export interface SettingsButtonProps {
  onClick(): void;
}

export function SettingsButton({ onClick }: SettingsButtonProps) {
  const t = useTranslator();
  return (
    <button
      class="icon-button"
      type="button"
      aria-label={t("settingsButton.label")}
      title={t("settingsButton.label")}
      onClick={onClick}
    >
      ⚙
    </button>
  );
}
