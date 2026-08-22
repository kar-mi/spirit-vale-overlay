import type { CharacterViewState } from "@kar-mi/spirit-vale-tools-character";

export function detectedPersonalName(state: CharacterViewState): string {
  return state.snapshot?.name.trim() ?? "";
}

export function syncPersonalCharacter(
  meter: { setPersonalName(name: string): void },
  state: CharacterViewState,
): void {
  meter.setPersonalName(detectedPersonalName(state));
}
