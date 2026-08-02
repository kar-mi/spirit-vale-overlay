import { describe, expect, test } from "bun:test";

import type {
  MobRewardMobSummary,
  RecordedMobRewardKill,
} from "@kar-mi/spirit-vale-tools-rewards";
import { attributedKills, attributedMobSummaries } from "./reward-display.ts";

describe("reward display projection", () => {
  test("recent kills excludes deaths without an attributed reward", () => {
    expect(attributedKills([kill("rewarded", true), kill("unrewarded", false)]).map(({ id }) => id))
      .toEqual(["rewarded"]);
  });

  test("summary kill counts include only attributed kills", () => {
    const projected = attributedMobSummaries([
      mob("mixed", 5, 2),
      mob("unrewarded", 3, 0),
    ]);

    expect(projected).toHaveLength(1);
    expect(projected[0]?.mobId).toBe("mixed");
    expect(projected[0]?.kills).toBe(2);
    expect(projected[0]?.attributedKills).toBe(2);
  });
});

function kill(id: string, attributed: boolean): RecordedMobRewardKill {
  return {
    kind: "kill",
    id,
    tick: 1,
    attributed,
    mob: { objectId: 1, mobId: "mob", displayName: "Mob", level: 1, boss: false },
    experience: attributed ? 10 : 0,
    jobExperience: 0,
    coins: 0n,
    drops: [],
  };
}

function mob(mobId: string, kills: number, attributedKills: number): MobRewardMobSummary {
  return {
    mobId,
    displayName: mobId,
    level: 1,
    boss: false,
    kills,
    attributedKills,
    experience: 10,
    jobExperience: 0,
    coins: 0n,
    drops: [],
  };
}
