import { FishNetActorDirectory } from "@kar-mi/spirit-vale-tools-combat";
import type {
  FishNetActorIdentity,
  FishNetActorIdentityEvent,
} from "@kar-mi/spirit-vale-tools-combat";
import type { DecodedFishNetPacket } from "@kar-mi/spirit-vale-tools-capture";

/**
 * Compatibility boundary for the currently published combat package. Player identities are
 * session facts, not spawned-object lifetime facts, so they remain available until direct player
 * or monster identity data replaces them, or the FishNet connection genuinely resets.
 */
export class StickyActorDirectory extends FishNetActorDirectory {
  private readonly retained = new Map<number, FishNetActorIdentity>();
  /**
   * Actor ids with positive evidence of being a monster or a summon/clone (never inferred from the
   * *absence* of player evidence, which would risk a real player's identity). Despawn clears these
   * immediately instead of leaving them sticky - only a player's identity is meant to outlive its
   * object's despawn/respawn cycle.
   */
  private readonly nonPlayerActorIds = new Set<number>();
  /**
   * Actor ids force-cleared by a non-player despawn. The base class itself never forgets an
   * identity on a plain despawn (`removeObject(..., retainIdentity: true)`, unconditionally, for
   * every despawn - that's what lets a *player's* identity survive their own respawn), so
   * `super.getAttribution()` would keep answering for a despawned monster/summon/clone forever
   * without this mask. Cleared again the moment any fresh identity is upserted for the same id.
   */
  private readonly clearedOnDespawn = new Set<number>();

  consume(packet: DecodedFishNetPacket): FishNetActorIdentityEvent[] {
    const monsterActorId = directMonsterActorId(packet);
    const nonPlayerActorId = monsterActorId ?? directSummonActorId(packet);
    const events = super.consume(packet);
    if (packet.packetName === "authenticated" || packet.packetName === "disconnect") {
      this.retained.clear();
      this.nonPlayerActorIds.clear();
      this.clearedOnDespawn.clear();
      return events;
    }

    const emitted = this.retain(events, monsterActorId);
    if (monsterActorId !== undefined && this.retained.delete(monsterActorId)
      && !emitted.some((event) => event.operation === "remove" && event.actorId === monsterActorId)) {
      emitted.push({ kind: "actorIdentity", operation: "remove", tick: packet.tick, actorId: monsterActorId });
    }
    if (nonPlayerActorId !== undefined) this.nonPlayerActorIds.add(nonPlayerActorId);

    if (packet.packetName === "objectDespawn" && packet.objectId !== undefined
      && this.nonPlayerActorIds.delete(packet.objectId)) {
      const hadIdentity = this.retained.has(packet.objectId) || super.getAttribution(packet.objectId) !== undefined;
      this.retained.delete(packet.objectId);
      this.clearedOnDespawn.add(packet.objectId);
      if (hadIdentity && !emitted.some((event) => event.operation === "remove" && event.actorId === packet.objectId)) {
        emitted.push({ kind: "actorIdentity", operation: "remove", tick: packet.tick, actorId: packet.objectId });
      }
    }
    return emitted;
  }

  observePlayerActor(actorId: number, tick: number): FishNetActorIdentityEvent[] {
    return this.retain(super.observePlayerActor(actorId, tick));
  }

  getAttribution(actorId: number): FishNetActorIdentity | undefined {
    if (this.clearedOnDespawn.has(actorId)) return undefined;
    return super.getAttribution(actorId) ?? clone(this.retained.get(actorId));
  }

  snapshot(): FishNetActorIdentity[] {
    const identities = new Map(this.retained);
    for (const identity of super.snapshot()) identities.set(identity.actorId, identity);
    for (const actorId of this.clearedOnDespawn) identities.delete(actorId);
    return [...identities.values()].map((identity) => ({ ...identity }));
  }

  reset(): void {
    super.reset();
    this.retained.clear();
    this.nonPlayerActorIds.clear();
    this.clearedOnDespawn.clear();
  }

  private retain(events: readonly FishNetActorIdentityEvent[], authoritativeRemoval?: number): FishNetActorIdentityEvent[] {
    const emitted: FishNetActorIdentityEvent[] = [];
    for (const event of events) {
      if (event.operation === "reset") {
        this.retained.clear();
        this.clearedOnDespawn.clear();
        emitted.push(event);
      } else if (event.operation === "upsert") {
        this.retained.set(event.actorId, identityFrom(event));
        this.clearedOnDespawn.delete(event.actorId);
        emitted.push(event);
      } else if (event.actorId === authoritativeRemoval) {
        this.retained.delete(event.actorId);
        emitted.push(event);
      }
    }
    return emitted;
  }
}

function directMonsterActorId(packet: DecodedFishNetPacket): number | undefined {
  if (packet.objectId === undefined) return undefined;
  if (packet.packetName === "objectSpawn") {
    const entry = packet.spawnSyncEntries?.find(
      (candidate) => candidate.networkBehaviourType === "MonsterController" && candidate.name === "Data",
    );
    const mobId = entry?.fields.find((field) => field.name === "Id")?.value;
    return typeof mobId === "string" && mobId.length > 0 ? packet.objectId : undefined;
  }
  if (packet.packetName !== "syncType" || packet.networkBehaviourType !== "MonsterController") return undefined;
  const mobId = packet.decodedFields?.find(
    (field) => field.name === "Data.Id" || field.name === "Monster.Id" || field.name === "Id",
  )?.value;
  return typeof mobId === "string" && mobId.length > 0 ? packet.objectId : undefined;
}

/**
 * A summon/clone's own object reports `SummoningComponent.SummonerSync`, a reference back to its
 * owner - the owner's own `SummoningComponent` instance (`PrimarySync`/`CalibrateSummons_T`) never
 * carries this field, so it can't be mistaken for the player who owns the summon.
 */
function directSummonActorId(packet: DecodedFishNetPacket): number | undefined {
  if (packet.objectId === undefined) return undefined;
  if (packet.packetName === "objectSpawn") {
    const hasSummonerSync = packet.spawnSyncEntries?.some(
      (candidate) => candidate.networkBehaviourType === "SummoningComponent" && candidate.name === "SummonerSync",
    ) ?? false;
    return hasSummonerSync ? packet.objectId : undefined;
  }
  if (packet.packetName !== "syncType" || packet.networkBehaviourType !== "SummoningComponent") return undefined;
  const hasSummonerSync = packet.decodedFields?.some((field) => field.name === "SummonerSync") ?? false;
  return hasSummonerSync ? packet.objectId : undefined;
}

function identityFrom(event: Extract<FishNetActorIdentityEvent, { operation: "upsert" }>): FishNetActorIdentity {
  return {
    actorId: event.actorId,
    displayName: event.displayName,
    ...(event.archetype === undefined ? {} : { archetype: event.archetype }),
    ...(event.ownerConnectionId === undefined ? {} : { ownerConnectionId: event.ownerConnectionId }),
    ...(event.uid === undefined ? {} : { uid: event.uid }),
  };
}

function clone(identity: FishNetActorIdentity | undefined): FishNetActorIdentity | undefined {
  return identity ? { ...identity } : undefined;
}
