import type {
  MobRewardMobSummary,
  RecordedMobRewardKill,
} from "@kar-mi/spirit-vale-tools-rewards";

export function attributedKills(kills: readonly RecordedMobRewardKill[]): RecordedMobRewardKill[] {
  return kills.filter((kill) => kill.attributed);
}

export function attributedMobSummaries(
  mobs: readonly MobRewardMobSummary[],
): MobRewardMobSummary[] {
  return mobs.flatMap((mob) => mob.attributedKills === 0
    ? []
    : [{ ...mob, kills: mob.attributedKills }]);
}
