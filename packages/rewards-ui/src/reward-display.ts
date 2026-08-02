import type {
  MobRewardMobSummary,
  RecordedMobRewardKill,
} from "@kar-mi/spirit-vale-tools-rewards";

/** Only kills with a reward attribution belong in the rewards UI. */
export function attributedKills(kills: readonly RecordedMobRewardKill[]): RecordedMobRewardKill[] {
  return kills.filter((kill) => kill.attributed);
}

/** Hide unrewarded mobs and report only the kills represented by their reward totals. */
export function attributedMobSummaries(
  mobs: readonly MobRewardMobSummary[],
): MobRewardMobSummary[] {
  return mobs.flatMap((mob) => mob.attributedKills === 0
    ? []
    : [{ ...mob, kills: mob.attributedKills }]);
}
