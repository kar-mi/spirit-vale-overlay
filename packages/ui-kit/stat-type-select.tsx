import { useTranslator } from "@svoverlay/i18n/browser";
import { CustomSelect } from "./custom-select.tsx";

export type StatType = "damage" | "tanked" | "heal";

export interface StatTypeSelectProps {
  value: StatType;
  onChange(value: StatType): void;
  disabled?: boolean;
}

export function StatTypeSelect({ value, onChange, disabled }: StatTypeSelectProps) {
  const t = useTranslator();
  const options = [
    { value: "damage", label: t("statType.damage") },
    { value: "tanked", label: t("statType.tanked") },
    { value: "heal", label: t("statType.heal") },
  ];
  return (
    <label class="stat-type-picker">
      <span class="t-label">{t("statType.label")}</span>
      <CustomSelect
        ariaLabel={t("statType.aria")}
        disabled={disabled}
        value={value}
        options={options}
        onChange={(next) => onChange(next as StatType)}
      />
    </label>
  );
}
