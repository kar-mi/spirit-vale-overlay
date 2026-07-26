import { describe, expect, test } from "bun:test";
import type { CharacterViewState } from "@kar-mi/spirit-vale-tools-character";

import {
  createPersonalDpsMeter,
  detectedPersonalName,
  syncPersonalCharacter,
} from "./personal-character.ts";

describe("overlay personal character detection", () => {
  test("uses the active cached character immediately", () => {
    const state = characterState("Fictional Hero", "cached");
    const meter = createPersonalDpsMeter(state);

    expect(detectedPersonalName(state)).toBe("Fictional Hero");
    expect(meter.getPersonalName()).toBe("Fictional Hero");
  });

  test("switches to a newly detected live character", () => {
    const meter = createPersonalDpsMeter(characterState("Fictional Hero", "cached"));

    syncPersonalCharacter(meter, characterState("Example Ranger", "live"));

    expect(meter.getPersonalName()).toBe("Example Ranger");
  });

  test("leaves personal damage unconfigured without a character snapshot", () => {
    const state = { stats: [], gearTotals: [], status: "waiting", statusDetail: "Waiting" } satisfies CharacterViewState;
    const meter = createPersonalDpsMeter(state);

    expect(detectedPersonalName(state)).toBe("");
    expect(meter.getPersonalName()).toBe("");
  });

  test("retains the detected character when the meter is recreated", () => {
    const state = characterState("Fictional Hero", "live");

    const replacement = createPersonalDpsMeter(state);

    expect(replacement.getPersonalName()).toBe("Fictional Hero");
  });
});

function characterState(name: string, source: "cached" | "live"): CharacterViewState {
  return {
    snapshot: { name, source } as CharacterViewState["snapshot"],
    stats: [],
    gearTotals: [],
    status: source,
    statusDetail: source === "live" ? "Live" : "Cached",
  };
}
