import { useTranslator } from "@svoverlay/i18n/browser";
import { CheckboxMultiSelect } from "./checkbox-multi-select.tsx";

export interface EnemyFilterOption {
  targetId: number;
  label: string;
}

export interface EnemyFilterControlProps {
  enemies: readonly EnemyFilterOption[];
  selected: ReadonlySet<number>;
  onChange(selected: Set<number>): void;
}

export function EnemyFilterControl({ enemies, selected, onChange }: EnemyFilterControlProps) {
  const t = useTranslator();
  return (
    <CheckboxMultiSelect
      options={enemies.map((enemy) => ({ value: enemy.targetId, label: enemy.label }))}
      selected={selected}
      onChange={onChange}
      ariaLabel={t("enemyFilter.aria")}
      searchPlaceholder={t("enemyFilter.searchPlaceholder")}
      clearLabel={t("enemyFilter.clear")}
      noMatchLabel={(query) => t("enemyFilter.noMatch", { query })}
      summarize={(chosen, options) => chosen.size === 0
        ? t("enemyFilter.all")
        : chosen.size === 1
          ? options.find((option) => chosen.has(option.value))?.label ?? t.plural("enemyFilter.count", 1)
          : t.plural("enemyFilter.count", chosen.size)}
    />
  );
}
