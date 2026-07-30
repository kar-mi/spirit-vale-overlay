export interface SettingsButtonProps {
  onClick(): void;
}

/** Standard title-bar control that opens the application-wide Settings window. */
export function SettingsButton({ onClick }: SettingsButtonProps) {
  return (
    <button
      class="icon-button"
      type="button"
      aria-label="Settings"
      title="Settings"
      onClick={onClick}
    >
      ⚙
    </button>
  );
}
