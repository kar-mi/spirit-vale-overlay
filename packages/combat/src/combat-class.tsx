import { classDisplayForArchetype } from "@svoverlay/ui-kit/class-display";

export function CombatClassCell({ archetype }: { archetype: number | undefined }) {
  const display = classDisplayForArchetype(archetype);
  return (
    <td class="combat-class-cell">
      <span class="combat-class-content">
        {display.iconUrl
          ? <img class="combat-class-icon" src={display.iconUrl} alt="" aria-hidden="true" />
          : <span class="combat-class-placeholder" aria-hidden="true">?</span>}
        <span class="combat-class-name">{display.name}</span>
      </span>
    </td>
  );
}
