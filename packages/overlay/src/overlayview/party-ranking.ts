import type { FishNetDpsActorRow } from "@kar-mi/spirit-vale-tools-combat";

const MAX_PARTY_ROWS = 12;
export const PARTY_ACTOR_IDLE_TIMEOUT_MS = 60_000;

export function visiblePartyActors(actors: readonly FishNetDpsActorRow[], nowMs: number): FishNetDpsActorRow[] {
  return actors
    .filter((actor) => actor.dps > 0
      && actor.lastDamageAtMs !== undefined
      && nowMs - actor.lastDamageAtMs <= PARTY_ACTOR_IDLE_TIMEOUT_MS)
    .sort((left, right) => right.dps - left.dps)
    .slice(0, MAX_PARTY_ROWS);
}
