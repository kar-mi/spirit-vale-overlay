import { FishNetDpsMeter } from "@kar-mi/spirit-vale-tools-combat";
import type { CharacterViewState } from "@kar-mi/spirit-vale-tools-character";

export function detectedPersonalName(state: CharacterViewState): string {
  return state.snapshot?.name.trim() ?? "";
}

export function createPersonalDpsMeter(state: CharacterViewState): FishNetDpsMeter {
  return new FishNetDpsMeter({ personalName: detectedPersonalName(state) });
}

export function syncPersonalCharacter(meter: FishNetDpsMeter, state: CharacterViewState): void {
  meter.setPersonalName(detectedPersonalName(state));
}
