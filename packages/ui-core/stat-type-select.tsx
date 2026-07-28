export type StatType = "damage" | "tanked" | "heal";

export interface StatTypeSelectProps {
  value: StatType;
  onChange(value: StatType): void;
  disabled?: boolean;
}

/** Picker for which combat metric a view displays: damage dealt, damage taken, or healing. */
export function StatTypeSelect({ value, onChange, disabled }: StatTypeSelectProps) {
  return (
    <label class="stat-type-picker">
      <span class="t-label">Stat</span>
      <select
        class="input"
        aria-label="Stat type"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange((event.target as HTMLSelectElement).value as StatType)}
      >
        <option value="damage">Damage (DPS)</option>
        <option value="tanked">Tank (TPS)</option>
        <option value="heal">Heal (HPS)</option>
      </select>
    </label>
  );
}
