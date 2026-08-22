import { CustomSelect } from "./custom-select.tsx";

export type StatType = "damage" | "tanked" | "heal";

export interface StatTypeSelectProps {
  value: StatType;
  onChange(value: StatType): void;
  disabled?: boolean;
}

const OPTIONS = [
  { value: "damage", label: "Damage (DPS)" },
  { value: "tanked", label: "Tank (TPS)" },
  { value: "heal", label: "Heal (HPS)" },
] as const;

export function StatTypeSelect({ value, onChange, disabled }: StatTypeSelectProps) {
  return (
    <label class="stat-type-picker">
      <span class="t-label">Stat</span>
      <CustomSelect
        ariaLabel="Stat type"
        disabled={disabled}
        value={value}
        options={OPTIONS}
        onChange={(next) => onChange(next as StatType)}
      />
    </label>
  );
}
