import { mobDefinitionsById } from "@kar-mi/spirit-vale-tools-rewards";

export interface CombatMonsterIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly level: number;
}

const NON_REWARD_IDENTITIES: readonly CombatMonsterIdentity[] = [
  { id: "Target Dummy", displayName: "Bullseye", level: 0 },
  { id: "NightmareShadow", displayName: "Curse Manifestation", level: 0 },
  { id: "Devil Bat", displayName: "Fire Bat", level: 0 },
  { id: "Devil Hell", displayName: "Hell Bat", level: 0 },
  { id: "Devil Hades", displayName: "Inferno Bat", level: 0 },
  { id: "Training Dummy", displayName: "Sandbag", level: 0 },
  { id: "Practice Dummy", displayName: "Straw Dummy", level: 0 },
];

/** Complete combat identity catalog; the reward tracker still receives only reward-bearing mobs. */
export function combatMonsterIdentityCatalog(): Map<string, CombatMonsterIdentity> {
  const definitions = new Map<string, CombatMonsterIdentity>(mobDefinitionsById());
  for (const identity of NON_REWARD_IDENTITIES) definitions.set(identity.id, { ...identity });
  return definitions;
}
