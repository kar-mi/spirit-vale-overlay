import { describe, expect, test } from "bun:test";
import type { CharacterViewState } from "@kar-mi/spirit-vale-tools-character";

import { detectedPersonalName, syncPersonalCharacter } from "./personal-character.ts";

function meterStub(state?: CharacterViewState) {
  const meter = {
    personalName: "",
    setPersonalName(name: string) { meter.personalName = name; },
  };
  if (state) syncPersonalCharacter(meter, state);
  return meter;
}

describe("personal character detection", () => {
  test("uses the active cached character immediately", () => {
    const state = characterState("Fictional Hero", "cached");
    const meter = meterStub(state);

    expect(detectedPersonalName(state)).toBe("Fictional Hero");
    expect(meter.personalName).toBe("Fictional Hero");
  });

  test("switches to a newly detected live character", () => {
    const meter = meterStub(characterState("Fictional Hero", "cached"));

    syncPersonalCharacter(meter, characterState("Example Ranger", "live"));

    expect(meter.personalName).toBe("Example Ranger");
  });

  test("leaves personal damage unconfigured without a character snapshot", () => {
    const state = { stats: [], gearTotals: [], status: "waiting", statusDetail: "Waiting" } satisfies CharacterViewState;
    const meter = meterStub(state);

    expect(detectedPersonalName(state)).toBe("");
    expect(meter.personalName).toBe("");
  });

  test("retains the detected character when the meter is recreated", () => {
    const state = characterState("Fictional Hero", "live");

    const replacement = meterStub(state);

    expect(replacement.personalName).toBe("Fictional Hero");
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
