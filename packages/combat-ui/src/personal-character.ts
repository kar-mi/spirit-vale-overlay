import type { CharacterViewState } from "@kar-mi/spirit-vale-tools-character";

export function detectedPersonalName(state: CharacterViewState): string {
  return state.snapshot?.name.trim() ?? "";
}

/** Structural on purpose: `LiveCombatService` satisfies this without the module depending on it. */
export function syncPersonalCharacter(
  meter: { setPersonalName(name: string): void },
  state: CharacterViewState,
): void {
  meter.setPersonalName(detectedPersonalName(state));
}
