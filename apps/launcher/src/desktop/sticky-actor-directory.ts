import { FishNetActorDirectory } from "@kar-mi/spirit-vale-tools-combat";
import type {
  FishNetActorDirectoryOptions,
  FishNetActorIdentity,
  FishNetActorIdentityEvent,
  FishNetLocalIdentity,
} from "@kar-mi/spirit-vale-tools-combat";
import type { DecodedFishNetPacket } from "@kar-mi/spirit-vale-tools-capture";

/**
 * Compatibility boundary for the currently published combat package. Player identities are
 * session facts, not spawned-object lifetime facts, so they remain available until direct player
 * or monster identity data replaces them, or the FishNet connection genuinely resets.
 */
export class StickyActorDirectory extends FishNetActorDirectory {
  private readonly retained = new Map<number, FishNetActorIdentity>();

  constructor(options: FishNetActorDirectoryOptions = {}) {
    super(options);
  }

  consume(packet: DecodedFishNetPacket): FishNetActorIdentityEvent[] {
    const monsterActorId = directMonsterActorId(packet);
    const events = super.consume(packet);
    if (packet.packetName === "authenticated" || packet.packetName === "disconnect") {
      this.retained.clear();
      return events;
    }

    const emitted = this.retain(events, monsterActorId);
    if (monsterActorId !== undefined && this.retained.delete(monsterActorId)
      && !emitted.some((event) => event.operation === "remove" && event.actorId === monsterActorId)) {
      emitted.push({ kind: "actorIdentity", operation: "remove", tick: packet.tick, actorId: monsterActorId });
    }
    return emitted;
  }

  observePlayerActor(actorId: number, tick: number): FishNetActorIdentityEvent[] {
    return this.retain(super.observePlayerActor(actorId, tick));
  }

  getAttribution(actorId: number): FishNetActorIdentity | undefined {
    return super.getAttribution(actorId) ?? clone(this.retained.get(actorId));
  }

  snapshot(): FishNetActorIdentity[] {
    const identities = new Map(this.retained);
    for (const identity of super.snapshot()) identities.set(identity.actorId, identity);
    return [...identities.values()].map((identity) => ({ ...identity }));
  }

  reset(): void {
    super.reset();
    this.retained.clear();
  }

  setLocalIdentity(identity: FishNetLocalIdentity): void {
    super.setLocalIdentity(identity);
  }

  private retain(events: readonly FishNetActorIdentityEvent[], authoritativeRemoval?: number): FishNetActorIdentityEvent[] {
    const emitted: FishNetActorIdentityEvent[] = [];
    for (const event of events) {
      if (event.operation === "reset") {
        this.retained.clear();
        emitted.push(event);
      } else if (event.operation === "upsert") {
        this.retained.set(event.actorId, identityFrom(event));
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
