import type {
  FishNetConfirmedMobKill,
  FishNetMobRewardEvent,
  FishNetUnmatchedRewardEvent,
  RewardItem,
} from "@kar-mi/spirit-vale-tools-rewards";

interface PendingKill {
  kill: FishNetConfirmedMobKill;
  experienceAssigned: boolean;
  pickupAssigned: boolean;
}

/**
 * Reconciles coalesced rewards without changing the capture/log protocol. The reward totals live on
 * the latest kill in a group, while every kill covered by that update is marked attributed.
 */
export class RewardEventAttributor {
  private readonly kills = new Map<string, PendingKill>();
  private readonly rewards: FishNetUnmatchedRewardEvent[] = [];

  constructor(private readonly windowTicks = 30) {}

  consume(events: readonly FishNetMobRewardEvent[], currentTick: number): FishNetMobRewardEvent[] {
    const output: FishNetMobRewardEvent[] = [];
    for (const event of events) {
      if (event.kind === "kill") {
        this.kills.set(event.id, {
          kill: { ...event, drops: event.drops.map((drop) => ({ ...drop })) },
          experienceAssigned: event.experience !== 0 || event.jobExperience !== 0 || event.coins !== 0n,
          pickupAssigned: event.drops.length > 0,
        });
      } else if (event.reason === "ambiguous") {
        this.rewards.push({ ...event, drops: event.drops.map((drop) => ({ ...drop })) });
      } else {
        output.push(event);
      }
    }

    while (true) {
      const ready = this.rewards
        .map((reward, index) => ({ reward, index }))
        .filter(({ reward }) => currentTick >= reward.tick + this.windowTicks)
        .sort((left, right) => left.reward.tick - right.reward.tick)[0];
      if (!ready) break;
      const { reward } = ready;
      this.rewards.splice(ready.index, 1);
      const candidates = [...this.kills.values()]
        .filter((candidate) => reward.tick >= candidate.kill.tick
          && reward.tick - candidate.kill.tick <= this.windowTicks
          && (reward.reward === "experience" ? !candidate.experienceAssigned : !candidate.pickupAssigned))
        .sort((left, right) => left.kill.tick - right.kill.tick);
      if (candidates.length === 0) {
        output.push(reward);
        continue;
      }

      for (const candidate of candidates) {
        candidate.kill.attributed = true;
        if (reward.reward === "experience") candidate.experienceAssigned = true;
        else candidate.pickupAssigned = true;
      }
      const representative = candidates.at(-1)!;
      if (reward.reward === "experience") {
        representative.kill.experience += reward.experience;
        representative.kill.jobExperience += reward.jobExperience;
        representative.kill.coins += reward.coins;
      } else {
        representative.kill.drops = mergeItems(representative.kill.drops, reward.drops);
      }
    }

    for (const [id, candidate] of this.kills) {
      if (currentTick < candidate.kill.tick + this.windowTicks * 2) continue;
      this.kills.delete(id);
      output.push(candidate.kill);
    }
    return output.sort((left, right) => left.tick - right.tick);
  }

  flush(): FishNetMobRewardEvent[] {
    const output = this.consume([], Number.POSITIVE_INFINITY);
    this.reset();
    return output;
  }

  reset(): void {
    this.kills.clear();
    this.rewards.length = 0;
  }
}

function mergeItems(left: readonly RewardItem[], right: readonly RewardItem[]): RewardItem[] {
  const merged = new Map<string, RewardItem>();
  for (const item of [...left, ...right]) {
    const key = `${item.category}|${item.itemId}`;
    const existing = merged.get(key);
    if (existing) existing.count += item.count;
    else merged.set(key, { ...item });
  }
  return [...merged.values()];
}
