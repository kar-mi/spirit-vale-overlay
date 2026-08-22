export interface SettingsButtonProps {
  onClick(): void;
}

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
