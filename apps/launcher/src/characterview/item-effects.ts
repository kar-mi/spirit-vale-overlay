import type { FishNetItemEffect } from "@kar-mi/spirit-vale-tools-items";
import { resolveFishNetSkillDisplayName } from "@kar-mi/spirit-vale-tools-skills";
import { PERCENT_STATS, STAT_NAMES } from "@kar-mi/spirit-vale-tools-character";

export function formatItemEffects(effects: readonly FishNetItemEffect[]): string {
  return effects.map(formatItemEffect).join(", ");
}

export function formatItemEffect(effect: FishNetItemEffect): string {
  const value = signed(effect.value, PERCENT_STATS.has(effect.type) ? "%" : undefined);
  const target = effect.target;
  if (!target) return `${statName(effect.type)} ${value}`;

  if (target.kind === "status") {
    if (effect.type === 26) return `Resistance to ${target.id} ${value}`;
    if (effect.type === 183) return `${target.id} max stacks ${value}`;
    if (effect.type === 211) return `${target.id} duration ${value}`;
  }

  if (target.kind === "element") {
    if (effect.type === 44) return `Damage to ${target.id} ${value}`;
    if (effect.type === 46) return `${target.id} damage ${value}`;
    if (effect.type === 53) return `${target.id} resistance ${value}`;
    if (effect.type === 56) return `Damage from ${target.id} ${value}`;
  }

  if (target.kind === "skill") {
    const skill = resolveFishNetSkillDisplayName(target.id) ?? target.id;
    if (effect.type === 42) return `Grants ${skill} Lv ${effect.value}`;
    if (effect.type === 43) return `${skill} level ${value}`;
    if (effect.type === 49) return `${skill} damage ${value}`;
    return `${statName(effect.type)}: ${skill} ${value}`;
  }

  return `${statName(effect.type)} ${value}`;
}

function statName(type: number): string {
  return STAT_NAMES[type] ?? `Stat ${type}`;
}

function signed(value: number, suffix = ""): string {
  return `${value >= 0 ? "+" : ""}${value}${suffix}`;
}
