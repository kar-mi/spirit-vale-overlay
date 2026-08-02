import { describe, expect, test } from "bun:test";
import type { FishNetConfirmedMobKill, FishNetUnmatchedExperienceEvent } from "@kar-mi/spirit-vale-tools-rewards";
import { RewardEventAttributor } from "./reward-event-attributor.ts";

describe("RewardEventAttributor", () => {
  test("attributes one coalesced reward to a kill group without duplicating totals", () => {
    const attributor = new RewardEventAttributor(5);
    expect(attributor.consume([reward(12, 200, 20n)], 12)).toEqual([]);
    expect(attributor.consume([kill("first", 10), kill("second", 11)], 16)).toEqual([]);

    const events = attributor.consume([], 21);
    const kills = events.filter((event) => event.kind === "kill");
    expect(kills.map((entry) => [entry.id, entry.attributed])).toEqual([
      ["first", true],
      ["second", true],
    ]);
    expect(kills.reduce((total, entry) => total + entry.experience, 0)).toBe(200);
    expect(kills.reduce((total, entry) => total + entry.coins, 0n)).toBe(20n);
    expect(kills.find((entry) => entry.id === "first")?.experience).toBe(0);
    expect(kills.find((entry) => entry.id === "second")?.experience).toBe(200);
  });

  test("does not reuse a group member for the next reward update", () => {
    const attributor = new RewardEventAttributor(5);
    attributor.consume([reward(12, 200, 20n), reward(14, 100, 10n)], 14);
    attributor.consume([kill("first", 10), kill("second", 11), kill("third", 13)], 16);

    const kills = attributor.flush().filter((event) => event.kind === "kill");
    expect(kills.find((entry) => entry.id === "second")?.experience).toBe(200);
    expect(kills.find((entry) => entry.id === "third")?.experience).toBe(100);
  });
});

function kill(id: string, tick: number): FishNetConfirmedMobKill {
  return {
    kind: "kill",
    id,
    tick,
    mob: { objectId: tick, mobId: "mob", displayName: "Mob", level: 1, boss: false },
    experience: 0,
    jobExperience: 0,
    coins: 0n,
    drops: [],
    attributed: false,
  };
}

function reward(tick: number, experience: number, coins: bigint): FishNetUnmatchedExperienceEvent {
  return { kind: "unmatched", tick, reason: "ambiguous", reward: "experience", experience, jobExperience: 0, coins, drops: [] };
}
